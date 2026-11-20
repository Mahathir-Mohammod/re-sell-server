import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { toCents } from "../config/stripe.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";
import { computeTotals, grandTotalCents, groupBySeller, publicTotals } from "./pricingService.js";
import { refundOrder } from "./refundService.js";

const orders = () => getDb().collection(collections.orders);
const products = () => getDb().collection(collections.products);

// Server-side transition rules. The UI mirrors this list; the server is the authority.
export const TRANSITIONS = {
  pending: ["accepted", "rejected", "cancelled"],
  accepted: ["processing", "cancelled"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from] ?? [];
    throw new ApiError(
      400,
      allowed.length
        ? `Cannot go from ${from} to ${to}. Allowed: ${allowed.join(", ")}`
        : `Order is ${from} and can no longer change status`
    );
  }
}

// Prices and stock come from the database — the client only chooses ids and quantities.
export async function priceCart(buyerId, items, deliveryFee) {
  const ids = [...new Set(items.map((i) => i.productId))].filter((id) => ObjectId.isValid(id));
  if (ids.length !== items.length) throw new ApiError(400, "One of the products is invalid");

  const found = await products()
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
    .toArray();

  const byId = new Map(found.map((p) => [p._id.toString(), p]));
  const priced = [];

  for (const item of items) {
    // quantities are a trust boundary: never rely on the zod layer alone
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
      throw new ApiError(400, "Invalid quantity");
    }
    const product = byId.get(item.productId);
    if (!product) throw new ApiError(400, "One of the products no longer exists");
    if (product.status !== "available" || product.moderationStatus !== "approved") {
      throw new ApiError(400, `"${product.title}" is no longer available`);
    }
    if (product.stock < item.quantity) {
      throw new ApiError(400, `Only ${product.stock} left of "${product.title}"`);
    }
    if (product.sellerInfo?.userId === buyerId) {
      throw new ApiError(400, `You cannot buy your own listing "${product.title}"`);
    }

    priced.push({
      productId: product._id.toString(),
      title: product.title,
      price: product.price,
      quantity: item.quantity,
      image: product.images?.[0] ?? null,
      sellerId: product.sellerInfo?.userId ?? null,
      sellerName: product.sellerInfo?.name ?? "",
      sellerEmail: product.sellerInfo?.email ?? "",
      sellerPhone: product.sellerInfo?.phone ?? "",
    });
  }

  const totals = computeTotals(groupBySeller(priced), deliveryFee);
  return { groups: totals, summary: grandTotalCents(totals) };
}

export async function createPendingOrders(buyer, priced, { address, phone }) {
  const now = new Date();
  const docs = priced.groups.map((group) => ({
    buyerInfo: {
      userId: buyer.id,
      name: buyer.name,
      email: buyer.email,
      phone,
      address,
    },
    sellerInfo: group.sellerInfo,
    items: group.items,
    productId: group.items[0].productId,
    subtotal: group.subtotal,
    deliveryFee: group.deliveryFee,
    total: group.total,
    paymentStatus: "pending",
    orderStatus: "pending",
    transactionId: null,
    deliveryAddress: address,
    statusHistory: [{ status: "pending", at: now, by: buyer.id }],
    createdAt: now,
    updatedAt: now,
  }));

  const { insertedIds } = await orders().insertMany(docs);
  return docs.map((doc, i) => ({ ...doc, _id: insertedIds[i] }));
}

export async function attachIntent(orderIds, paymentIntentId) {
  await orders().updateMany(
    { _id: { $in: orderIds.map((id) => new ObjectId(id)) } },
    { $set: { paymentIntentId, updatedAt: new Date() } }
  );
}

export async function listMyOrders(buyerId, query) {
  const filter = { "buyerInfo.userId": buyerId };
  if (query.status) filter.orderStatus = query.status;

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    orders().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    orders().countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
}

export async function getOrderForBuyer(id, buyerId) {
  const order = await findOrder(id);
  if (order.buyerInfo?.userId !== buyerId) {
    throw new ApiError(403, "This order is not yours");
  }
  return order;
}

async function findOrder(id) {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "Order not found");
  const order = await orders().findOne({ _id: new ObjectId(id) });
  if (!order) throw new ApiError(404, "Order not found");
  return order;
}

// Paid orders are refunded before anything is mutated, so a failed refund leaves the
// order untouched instead of cancelling it without returning the money.
export async function cancelOrderForBuyer(id, buyerId, { stripe } = {}) {
  const order = await findOrder(id);
  if (order.buyerInfo?.userId !== buyerId) throw new ApiError(403, "This order is not yours");
  assertTransition(order.orderStatus, "cancelled");

  const wasPaid = order.paymentStatus === "paid";
  const refund = wasPaid ? await refundOrder(order, stripe) : null;

  const now = new Date();
  const history = [{ status: "cancelled", at: now, by: buyerId }];
  if (refund) history.push({ status: "refunded", at: now, by: "stripe", refundId: refund.refundId });

  await orders().updateOne(
    { _id: order._id },
    {
      $set: {
        orderStatus: "cancelled",
        ...(refund && { paymentStatus: "refunded" }),
        updatedAt: now,
      },
      $push: { statusHistory: { $each: history } },
    }
  );

  // the stock was taken when the payment succeeded, so give it back
  if (wasPaid) await restoreStock(order, now);

  return { ...order, orderStatus: "cancelled", ...(refund && { paymentStatus: "refunded", refund }) };
}

async function restoreStock(order, now) {
  for (const item of order.items ?? []) {
    if (!ObjectId.isValid(item.productId)) continue;
    const product = await products().findOne({ _id: new ObjectId(item.productId) });
    if (!product) continue;

    const stock = (product.stock ?? 0) + item.quantity;
    await products().updateOne(
      { _id: product._id },
      {
        $set: {
          stock,
          status: product.status === "sold" ? "available" : product.status,
          updatedAt: now,
        },
      }
    );
  }
}

// Applied by both the webhook and the confirm fallback: stock moves exactly once.
export async function markPaidByIntent(intent) {
  const orderIds = (intent.metadata?.orderIds ?? "").split(",").filter(Boolean);
  const buyerId = intent.metadata?.buyerId ?? null;
  if (!orderIds.length) return { updated: 0, orders: [], buyerId };

  const now = new Date();
  const updated = [];

  for (const id of orderIds) {
    if (!ObjectId.isValid(id)) continue;
    const order = await orders().findOne({ _id: new ObjectId(id) });
    if (!order || order.paymentStatus === "paid") continue;

    await orders().updateOne(
      { _id: order._id, paymentStatus: { $ne: "paid" } },
      {
        $set: {
          paymentStatus: "paid",
          transactionId: intent.id,
          paymentIntentId: intent.id,
          updatedAt: now,
        },
        $push: { statusHistory: { status: "paid", at: now, by: buyerId } },
      }
    );

    for (const item of order.items) {
      if (!ObjectId.isValid(item.productId)) continue;
      const product = await products().findOne({ _id: new ObjectId(item.productId) });
      if (!product) continue;

      const stock = Math.max(0, (product.stock ?? 0) - item.quantity);
      await products().updateOne(
        { _id: product._id },
        { $set: { stock, status: stock === 0 ? "sold" : "available", updatedAt: now } }
      );
    }

    updated.push(order._id.toString());
  }

  return { updated: updated.length, orders: updated, buyerId };
}

export async function markFailedByIntent(intentId, reason = "payment_failed") {
  const now = new Date();
  const result = await orders().updateMany(
    { transactionId: intentId, paymentStatus: "pending" },
    {
      $set: { paymentStatus: "failed", orderStatus: "cancelled", updatedAt: now },
      $push: { statusHistory: { status: "payment_failed", at: now, by: reason } },
    }
  );
  return result.modifiedCount;
}

export { toCents };