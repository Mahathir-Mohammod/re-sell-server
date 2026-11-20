import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { getStripe } from "../config/stripe.js";
import { ApiError } from "../utils/ApiError.js";
import {
  attachIntent,
  createPendingOrders,
  markFailedByIntent,
  markPaidByIntent,
  priceCart,
} from "./orderService.js";

const payments = () => getDb().collection(collections.payments);
const events = () => getDb().collection("stripeEvents");
const orders = () => getDb().collection(collections.orders);

export async function createPaymentIntent(buyer, { items, address, phone }, deliveryFee) {
  const priced = await priceCart(buyer.id, items, deliveryFee);
  const created = await createPendingOrders(buyer, priced, { address, phone });

  // summary.total is ALREADY in cents — converting again would charge 100x
  const expectedCents = priced.summary.total;

  const intent = await getStripe().paymentIntents.create({
    amount: expectedCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata: {
      buyerId: buyer.id,
      orderIds: created.map((o) => o._id.toString()).join(","),
      itemCount: String(items.reduce((sum, i) => sum + i.quantity, 0)),
    },
  });

  // Money invariant: never leave an intent whose amount disagrees with the cart.
  if (intent.amount !== expectedCents) {
    await getStripe().paymentIntents.cancel(intent.id).catch(() => {});
    throw new ApiError(500, "Payment amount mismatch, the charge was cancelled");
  }

  await attachIntent(created.map((o) => o._id), intent.id);

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amount: priced.summary.total / 100,
    subtotal: priced.summary.subtotal / 100,
    deliveryFee: priced.summary.delivery / 100,
    orderIds: created.map((o) => o._id.toString()),
  };
}

// Records the payment row once per intent. The unique index on transactionId is the
// real guard; a duplicate-key error means another path already recorded it.
async function recordPayment(intent, buyerId) {
  try {
    await payments().insertOne({
      orderIds: (intent.metadata?.orderIds ?? "").split(",").filter(Boolean),
      transactionId: intent.id,
      paymentIntentId: intent.id,
      buyerId: buyerId ?? intent.metadata?.buyerId ?? null,
      amount: (intent.amount_received ?? intent.amount) / 100,
      currency: intent.currency ?? "usd",
      method: "stripe",
      status: "paid",
      cardBrand: intent.charges?.data?.[0]?.payment_method_details?.card?.brand ?? null,
      last4: intent.charges?.data?.[0]?.payment_method_details?.card?.last4 ?? null,
      createdAt: new Date(),
      paidAt: new Date(),
    });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // already recorded
    throw err;
  }
}

export async function applySuccessfulPayment(intent) {
  const result = await markPaidByIntent(intent);
  const recorded = await recordPayment(intent, result.buyerId);
  return { ...result, paymentRecorded: recorded };
}

// Stripe retries webhooks; this makes replays a no-op.
async function alreadyHandled(eventId) {
  try {
    await events().insertOne({ _id: eventId, receivedAt: new Date() });
    return false;
  } catch (err) {
    if (err?.code === 11000) return true;
    throw err;
  }
}

export async function handleWebhookEvent(event) {
  if (await alreadyHandled(event.id)) return { duplicate: true, type: event.type };

  switch (event.type) {
    case "payment_intent.succeeded":
      return { ...(await applySuccessfulPayment(event.data.object)), type: event.type };
    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      const modified = await markFailedByIntent(intent.id, intent.last_payment_error?.message);
      return { modified, type: event.type };
    }
    default:
      return { ignored: true, type: event.type };
  }
}

// Fallback for when the webhook has not arrived yet (local dev, cold starts).
export async function confirmPayment(paymentIntentId, buyerId) {
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);

  if (intent.metadata?.buyerId !== buyerId) {
    throw new ApiError(403, "This payment is not yours");
  }
  if (intent.status !== "succeeded") {
    throw new ApiError(400, `Payment is ${intent.status}, not completed`);
  }

  return applySuccessfulPayment(intent);
}

export async function getPaymentForBuyer(id, buyerId) {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "Payment not found");
  const payment = await payments().findOne({ _id: new ObjectId(id) });
  if (!payment) throw new ApiError(404, "Payment not found");
  if (payment.buyerId !== buyerId) throw new ApiError(403, "This payment is not yours");

  const relatedOrders = await orders()
    .find({ _id: { $in: payment.orderIds.map(toObjectId).filter(Boolean) } })
    .toArray();

  return { ...payment, orders: relatedOrders };
}

export async function listMyPayments(buyerId, { page = 1, limit = 20 } = {}) {
  const skip = (Math.max(1, page) - 1) * limit;
  const [items, total] = await Promise.all([
    payments().find({ buyerId }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    payments().countDocuments({ buyerId }),
  ]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

function toObjectId(value) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}