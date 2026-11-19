import { z } from "zod";
import { pageQuery } from "../middleware/validate.js";

export const CONDITIONS = ["Used", "Like New", "Refurbished"];
export const SORTS = ["newest", "price_asc", "price_desc", "rating", "popular"];
export const MODERATION = ["pending", "approved", "rejected"];

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

const baseProductFields = {
  title: z.string().trim().min(3, "Title is too short").max(120),
  description: z.string().trim().min(10, "Description is too short").max(2000),
  category: z.string().trim().min(2).max(60),
  condition: z.enum(CONDITIONS),
  price: z.coerce.number().positive("Price must be greater than 0").max(1_000_000),
  stock: z.coerce.number().int().min(0).max(999),
  location: z.string().trim().min(2).max(80),
  images: z
    .array(z.string().trim().url("Image must be a URL").max(500))
    .min(1, "At least one image is required")
    .max(6),
};

export const createProductSchema = {
  body: z.object(baseProductFields),
};

const updateShape = Object.fromEntries(
  Object.entries(baseProductFields).map(([key, schema]) => [key, schema.optional()])
);

export const updateProductSchema = {
  body: z
    .object({
      ...updateShape,
      status: z.enum(["available", "unavailable", "sold"]).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "Nothing to update",
    }),
};

export const listProductsSchema = {
  query: z.object({
    ...pageQuery,
    search: z.string().trim().min(1).max(80).optional(),
    category: z.string().trim().max(60).optional(),
    condition: z.enum(CONDITIONS).optional(),
    sellerId: z.string().trim().max(64).optional(),
    location: z.string().trim().max(60).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z.enum(SORTS).optional(),
  }),
};

// sellers manage their own listings, so status/moderation are filterable there
export const myProductsSchema = {
  query: z.object({
    ...pageQuery,
    search: z.string().trim().min(1).max(80).optional(),
    status: z.enum(["available", "unavailable", "sold", "pending", "rejected"]).optional(),
  }),
};

export const productIdSchema = {
  params: z.object({ id: z.string().trim().min(1).max(120) }),
};

export const uploadSchema = {
  body: z.object({
    image: z.string().min(100, "Image data missing").max(12_000_000),
    name: z.string().trim().max(60).optional(),
  }),
};