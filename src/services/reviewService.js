import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";

const reviews = () => getDb().collection(collections.reviews);
const orders = () => getDb().collection(collections.orders);
const products = () => getDb().collection(collections.products);

export async function listProductReviews(productId) {
  return reviews().find({ productId }).sort({ createdAt: -1 }).limit(50).toArray();
}

// Only the buyer of a delivered order may review, once per product.
export async function createReview(reviewer, { orderId, productId, rating, comment }) {
  const order = ObjectId.isValid(orderId)
    ? await orders().findOne({ _id: new ObjectId(orderId) })
    : null;
  if (!order) throw new ApiError(404, "Order not found");

  if (order.buyerInfo?.userId !== reviewer.id) {
    throw new ApiError(403, "This order is not yours");
  }
  if (order.orderStatus !== "delivered") {
    throw new ApiError(400, "You can review an order once it has been delivered");
  }

  const item = (order.items ?? []).find((i) => i.productId === productId);
  if (!item) throw new ApiError(400, "That product is not part of this order");

  const existing = await reviews().findOne({ orderId, productId });
  if (existing) throw new ApiError(409, "You already reviewed this item");

  const now = new Date();
  const doc = {
    reviewerInfo: { userId: reviewer.id, name: reviewer.name },
    sellerId: order.sellerInfo?.userId ?? null,
    productId,
    orderId,
    rating,
    comment: comment ?? "",
    createdAt: now,
  };

  const { insertedId } = await reviews().insertOne(doc);
  await recomputeProductRating(productId);

  return { ...doc, _id: insertedId };
}

async function recomputeProductRating(productId) {
  if (!ObjectId.isValid(productId)) return;
  const agg = await reviews()
    .aggregate([
      { $match: { productId } },
      { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ])
    .next();

  await products().updateOne(
    { _id: new ObjectId(productId) },
    {
      $set: {
        ratingAvg: Number((agg?.avg ?? 0).toFixed(1)),
        ratingCount: agg?.count ?? 0,
        updatedAt: new Date(),
      },
    }
  );
}

// The buyer's own review state, so the order page knows whether to show the form.
export async function listReviewableOrderItems(buyerId) {
  const delivered = await orders()
    .find({ "buyerInfo.userId": buyerId, orderStatus: "delivered" })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  if (!delivered.length) return [];

  const orderIds = delivered.map((o) => o._id.toString());
  const existing = await reviews().find({ orderId: { $in: orderIds } }).toArray();
  const reviewed = new Set(existing.map((r) => `${r.orderId}:${r.productId}`));

  return delivered.flatMap((order) =>
    (order.items ?? []).map((item) => ({
      orderId: order._id.toString(),
      productId: item.productId,
      title: item.title,
      image: item.image,
      reviewed: reviewed.has(`${order._id.toString()}:${item.productId}`),
    }))
  );
}

export async function myReviews(buyerId, query) {
  const { page, limit, skip } = getPagination(query);
  const filter = { "reviewerInfo.userId": buyerId };
  const [items, total] = await Promise.all([
    reviews().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    reviews().countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
}