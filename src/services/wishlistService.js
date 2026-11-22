import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";

const wishlist = () => getDb().collection(collections.wishlist);
const products = () => getDb().collection(collections.products);

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// Saved rows point at products by id string, so the join happens here rather than in
// an aggregation: a wishlist is a handful of rows and this keeps it readable.
export async function listWishlist(userId, query) {
  const { page, limit, skip } = getPagination(query);

  const [rows, total] = await Promise.all([
    wishlist().find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    wishlist().countDocuments({ userId }),
  ]);

  const ids = rows.map((row) => toObjectId(row.productId)).filter(Boolean);
  const found = ids.length
    ? await products().find({ _id: { $in: ids } }).toArray()
    : [];
  const byId = new Map(found.map((p) => [p._id.toString(), p]));

  const items = [];
  const stale = [];
  for (const row of rows) {
    const product = byId.get(String(row.productId));
    // a listing deleted after being saved must not leave a blank card behind
    if (product) items.push({ ...product, wishedAt: row.createdAt });
    else stale.push(row._id);
  }
  if (stale.length) await wishlist().deleteMany({ _id: { $in: stale } });

  return {
    items,
    meta: paginationMeta(page, limit, Math.max(0, total - stale.length)),
  };
}

export async function addToWishlist(userId, productId) {
  const _id = toObjectId(productId);
  if (!_id) throw new ApiError(400, "Invalid product id");

  const product = await products().findOne({ _id }, { projection: { _id: 1 } });
  if (!product) throw new ApiError(404, "Product not found");

  try {
    // the unique index on { userId, productId } makes a double-click a no-op
    await wishlist().updateOne(
      { userId, productId },
      { $setOnInsert: { userId, productId, createdAt: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }

  return { productId, saved: true };
}

export async function removeFromWishlist(userId, productId) {
  if (!ObjectId.isValid(productId)) throw new ApiError(400, "Invalid product id");
  const { deletedCount } = await wishlist().deleteOne({ userId, productId });
  return { productId, removed: deletedCount > 0 };
}

export async function wishlistCount(userId) {
  return wishlist().countDocuments({ userId });
}