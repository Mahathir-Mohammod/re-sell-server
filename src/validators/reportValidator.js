import { z } from "zod";
import { objectId, pageQuery } from "../middleware/validate.js";

export const createReportSchema = {
  body: z.object({
    productId: objectId,
    reason: z.enum(["prohibited", "counterfeit", "misleading", "wrong-category", "other"]),
    details: z.string().trim().max(500).optional(),
  }),
};

export const reportListSchema = {
  query: z.object({
    ...pageQuery,
    status: z.enum(["open", "reviewed", "dismissed"]).optional(),
  }),
};

export const reportIdSchema = {
  params: z.object({ id: objectId }),
};

export const resolveReportSchema = {
  body: z.object({ status: z.enum(["reviewed", "dismissed"]) }),
};
