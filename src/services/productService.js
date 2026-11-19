import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";
import { uniqueSlug } from "../utils/slug.js";
import { buildProductFilter, sortSpec } from "../validators/productValidator.js";

const products = () => getDb().collection(collections.products);
const categoriesCol = () => getDb().collection(collections.categories);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

export async function listSellerProducts(userId, query) {
  const filter = { "sellerInfo.userId": userId };
  if (query.status) filter.status = query.status;
  if (query.search) {
    filter.title = new RegExp(escapeRegex(query.search).slice(0, 80), "i");
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    products().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
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

async function assertCategoryExists(slug) {
  const exists = await categoriesCol().findOne({ slug }, { projection: { _id: 1 } });
  if (!exists) throw new ApiError(400, `Unknown category: ${slug}`);
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

export async function createProduct(user, input) {
  await assertCategoryExists(input.category);

  const now = new Date();
  const doc = {
    ...input,
    slug: await uniqueSlug(input.title),
    images: input.images.slice(0, 6),
    sellerInfo: {
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: input.phone ?? "",
    },
    status: "available",
    // admin listings are trusted, seller listings wait for review
    moderationStatus: user.role === "admin" ? "approved" : "pending",
    isFeatured: false,
    views: 0,
    ratingAvg: 0,
    ratingCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const { insertedId } = await products().insertOne(doc);
  return { ...doc, _id: insertedId };
}

// Ownership is the only authorization rule sellers have on their own listings.
function assertOwner(product, user) {
  if (user.role === "admin") return;
  if (product.sellerInfo?.userId !== user.id) {
    throw new ApiError(403, "You can only change your own listings");
  }
}

export async function updateProduct(id, user, patch) {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "Product not found");
  const _id = new ObjectId(id);

  const product = await products().findOne({ _id });
  if (!product) throw new ApiError(404, "Product not found");
  assertOwner(product, user);

  if (patch.category) await assertCategoryExists(patch.category);

  const update = { ...patch, updatedAt: new Date() };
  if (patch.title) update.slug = await uniqueSlug(patch.title, { excludeId: _id });
  // a seller editing an approved listing sends it back for review; admins don't
  if (user.role !== "admin") update.moderationStatus = "pending";

  await products().updateOne({ _id }, { $set: update });
  return { ...product, ...update };
}

export async function deleteProduct(id, user) {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "Product not found");
  const _id = new ObjectId(id);

  const product = await products().findOne({ _id });
  if (!product) throw new ApiError(404, "Product not found");
  assertOwner(product, user);

  await products().deleteOne({ _id });
  return { _id };
}