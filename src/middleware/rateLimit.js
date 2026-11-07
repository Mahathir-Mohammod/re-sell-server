import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

// Blanket limiter for the whole API. Payment/write endpoints get tighter limits later.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 10_000 : 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, try again later" },
});