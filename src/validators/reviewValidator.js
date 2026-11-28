import { z } from "zod";
import { objectId, pageQuery } from "../middleware/validate.js";

export const createReviewSchema = {
  body: z.object({
    orderId: objectId,
    productId: z.string().trim().min(1).max(64),
    rating: z.coerce.number().int().min(1, "Pick 1-5 stars").max(5),
    comment: z.string().trim().max(1000).optional(),
  }),
};

export const productIdParamSchema = {
  params: z.object({ id: z.string().trim().min(1).max(120) }),
};

export const myReviewsSchema = {
  query: z.object({ ...pageQuery }),
};
