import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";
import { findOrder, transitionOrder } from "./orderService.js";

const orders = () => getDb().collection(collections.orders);
const products = () => getDb().collection(collections.products);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listSellerOrders(sellerId, query) {
  const filter = { "sellerInfo.userId": sellerId };
  if (query.status) filter.orderStatus = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search).slice(0, 80), "i");
    filter.$or = [{ "items.title": rx }, { "buyerInfo.name": rx }, { "buyerInfo.email": rx }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    orders().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    orders().countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
}

// Admins may act on any order; sellers only on orders addressed to them.
async function assertSellerOwns(order, user) {
  if (user.role === "admin") return order;
  if (order.sellerInfo?.userId !== user.id) {
    throw new ApiError(403, "This order is not for your listings");
  }
  return order;
}

export async function getSellerOrder(id, user) {
  return assertSellerOwns(await findOrder(id), user);
}

export async function updateSellerOrderStatus(id, user, status, { stripe } = {}) {
  const order = await assertSellerOwns(await findOrder(id), user);
  return transitionOrder(order, status, user.id, { stripe });
}

const PAID = { $eq: ["$paymentStatus", "paid"] };

const unitsOfItems = {
  $sum: { $map: { input: { $ifNull: ["$items", []] }, as: "i", in: "$$i.quantity" } },
};

export async function sellerStats(sellerId) {
  const mine = { "sellerInfo.userId": sellerId };

  const [totalProducts, liveListings, pendingReview, agg] = await Promise.all([
    products().countDocuments(mine),
    products().countDocuments({ ...mine, status: "available", moderationStatus: "approved" }),
    products().countDocuments({ ...mine, moderationStatus: "pending" }),
    orders()
      .aggregate([
        { $match: mine },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            paidOrders: { $sum: { $cond: [PAID, 1, 0] } },
            pendingOrders: { $sum: { $cond: [{ $eq: ["$orderStatus", "pending"] }, 1, 0] } },
            revenue: { $sum: { $cond: [PAID, "$total", 0] } },
            unitsSold: { $sum: { $cond: [PAID, unitsOfItems, 0] } },
          },
        },
      ])
      .next(),
  ]);

  const revenue = Number((agg?.revenue ?? 0).toFixed(2));
  const paidOrders = agg?.paidOrders ?? 0;

  return {
    totalProducts,
    liveListings,
    pendingReview,
    orders: agg?.orders ?? 0,
    pendingOrders: agg?.pendingOrders ?? 0,
    revenue,
    unitsSold: agg?.unitsSold ?? 0,
    averageOrderValue: paidOrders ? Number((revenue / paidOrders).toFixed(2)) : 0,
  };
}