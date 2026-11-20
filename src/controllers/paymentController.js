import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { ok } from "../utils/apiResponse.js";
import { getStripe, isStripeConfigured } from "../config/stripe.js";
import {
  confirmPayment,
  createPaymentIntent,
  getPaymentForBuyer,
  handleWebhookEvent,
  listMyPayments,
} from "../services/paymentService.js";

export async function createIntent(req, res) {
  const { items, address, phone } = req.validated.body;
  ok(res, await createPaymentIntent(req.user, { items, address, phone }, env.DELIVERY_FEE));
}

export async function confirm(req, res) {
  ok(res, await confirmPayment(req.validated.body.paymentIntentId, req.user.id));
}

export async function getPayment(req, res) {
  ok(res, await getPaymentForBuyer(req.validated.params.id, req.user.id));
}

export async function myPayments(req, res) {
  const { items, meta } = await listMyPayments(req.user.id, {
    page: Number(req.query.page) || 1,
    limit: Math.min(50, Number(req.query.limit) || 20),
  });
  ok(res, items, meta);
}

// Stripe needs the untouched request bytes, so this handler receives req.body as a Buffer
// (express.raw is mounted for this path in app.js, before express.json).
export async function webhook(req, res) {
  if (!isStripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
    throw new ApiError(503, "Webhook is not configured (STRIPE_WEBHOOK_SECRET missing)");
  }

  const signature = req.get("stripe-signature");
  if (!signature) throw new ApiError(400, "Missing stripe-signature header");

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    throw new ApiError(400, `Webhook signature verification failed: ${err.message}`);
  }

  const result = await handleWebhookEvent(event);
  res.json({ received: true, ...result });
}