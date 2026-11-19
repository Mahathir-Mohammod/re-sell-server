import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";

export const slugify = (text) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

// Appends -2, -3, ... until free. Unique index on slug is the real guard;
// this just avoids the common collision case without an error round trip.
export async function uniqueSlug(title, { excludeId } = {}) {
  const base = slugify(title) || "item";
  const product = getDb().collection(collections.products);

  for (let i = 1; i <= 50; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const clash = await product.findOne(
      { slug, ...(excludeId && { _id: { $ne: excludeId } }) },
      { projection: { _id: 1 } }
    );
    if (!clash) return slug;
  }

  return `${base}-${Date.now()}`;
}