import { z } from "zod";
import { pageQuery } from "../middleware/validate.js";

export const CONDITIONS = ["Used", "Like New", "Refurbished"];
export const SORTS = ["newest", "price_asc", "price_desc", "rating", "popular"];

const SORT_SPEC = {
  newest: { createdAt: -1 },
  price_asc: { price: 1 },
  price_desc: { price: -1 },
  rating: { ratingAvg: -1, ratingCount: -1 },
  popular: { views: -1 },
};

export const sortSpec = (sort) => SORT_SPEC[sort] ?? SORT_SPEC.newest;

// Escaped so user input can't inject regex syntax into the search.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildProductFilter(query) {
  const filter = { status: "available", moderationStatus: "approved" };

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search).slice(0, 80), "i");
    filter.$or = [{ title: rx }, { description: rx }];
  }
  if (query.category) filter.category = query.category;
  if (query.condition) filter.condition = query.condition;
  if (query.sellerId) filter["sellerInfo.userId"] = query.sellerId;
  if (query.location) filter.location = new RegExp(escapeRegex(query.location), "i");
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.price = {
      ...(query.minPrice !== undefined && { $gte: query.minPrice }),
      ...(query.maxPrice !== undefined && { $lte: query.maxPrice }),
    };
  }

  return filter;
}

export const listProductsSchema = {
  query: z.object({
    ...pageQuery,
    search: z.string().trim().min(1).max(80).optional(),
    location: z.string().trim().max(60).optional(),
    category: z.string().trim().max(60).optional(),
    condition: z.enum(CONDITIONS).optional(),
    sellerId: z.string().trim().max(64).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z.enum(SORTS).optional(),
  }),
};

export const productIdSchema = {
  params: z.object({ id: z.string().trim().min(1).max(120) }),
};