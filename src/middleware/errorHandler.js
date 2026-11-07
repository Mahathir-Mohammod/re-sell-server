import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { isProd } from "../config/env.js";

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: err.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err?.code === 11000) {
    return res
      .status(409)
      .json({ success: false, message: "Duplicate entry" });
  }

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Invalid JSON body" });
  }

  console.error(err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    ...(isProd ? {} : { detail: err?.message }),
  });
}