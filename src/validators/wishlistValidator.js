import { z } from "zod";
import { objectId, pageQuery } from "../middleware/validate.js";

export const wishlistQuerySchema = {
  query: z.object({ ...pageQuery }),
};

export const addWishlistSchema = {
  body: z.object({ productId: objectId }),
};

export const wishlistItemSchema = {
  params: z.object({ productId: objectId }),
};
