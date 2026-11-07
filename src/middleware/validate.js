import { z } from "zod";

// Express 5 makes req.query a read-only getter, so parsed input goes on req.validated.
export const validate =
  (schemas) =>
  (req, res, next) => {
    req.validated = {};
    for (const key of ["params", "query", "body"]) {
      if (schemas[key]) req.validated[key] = schemas[key].parse(req[key]);
    }
    next();
  };

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid id");

export const pageQuery = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
};