import Stripe from "stripe";
import { ApiError } from "../utils/ApiError.js";

let client;

export const isStripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new ApiError(503, "Payments are not configured (STRIPE_SECRET_KEY missing)");
  }
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

// Money is handled in integer cents everywhere to avoid float drift; the DB keeps
// decimals only for display, and those are derived from the same rounding.
export const toCents = (amount) => Math.round(Number(amount) * 100);
export const fromCents = (cents) => Number((cents / 100).toFixed(2));