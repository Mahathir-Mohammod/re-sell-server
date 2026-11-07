import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";
import { buildProductFilter, sortSpec } from "../validators/productValidator.js";

const products = () => getDb().collection(collections.products);
const categoriesCol = () => getDb().collection(collections.categories);

export async function listProducts(query) {
  const filter = buildProductFilter(query);
  const { page, limit, skip } = getPagination(query);

  const [items, total] = await Promise.all([
    products()
      .find(filter)
      .sort(sortSpec(query.sort))
      .skip(skip)
      .limit(limit)
      .toArray(),
    products().countDocuments(filter),
  ]);

  return { items, meta: paginationMeta(page, limit, total) };
}

export async function getProduct(idOrSlug) {
  const byId = ObjectId.isValid(idOrSlug) ? { _id: new ObjectId(idOrSlug) } : { slug: idOrSlug };
  const product = await products().findOne(byId);
  if (!product) throw new ApiError(404, "Product not found");
  return product;
}

// Fire-and-forget view counter; a failed inc must never fail the page load.
export function recordView(id) {
  if (!ObjectId.isValid(id)) return;
  products()
    .updateOne({ _id: new ObjectId(id) }, { $inc: { views: 1 } })
    .catch((err) => console.error("view counter failed:", err.message));
}

export async function listFeatured(limit = 8) {
  return products()
    .find({ status: "available", moderationStatus: "approved", isFeatured: true })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function listCategories() {
  const [categories, counts] = await Promise.all([
    categoriesCol().find({}).sort({ name: 1 }).toArray(),
    products()
      .aggregate([
        { $match: { status: "available", moderationStatus: "approved" } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const countBySlug = new Map(counts.map((c) => [c._id, c.count]));
  return categories.map((c) => ({
    ...c,
    productCount: countBySlug.get(c.slug) ?? 0,
  }));
}