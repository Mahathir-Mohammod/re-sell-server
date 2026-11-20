import { env } from "../config/env.js";
import { ok } from "../utils/apiResponse.js";
import { listMyOrders, getOrderForBuyer, cancelOrderForBuyer } from "../services/orderService.js";

export async function getMyOrders(req, res) {
  const { items, meta } = await listMyOrders(req.user.id, req.validated.query);
  ok(res, items, meta);
}

export async function getOrder(req, res) {
  ok(res, await getOrderForBuyer(req.validated.params.id, req.user.id));
}

export async function cancelOrder(req, res) {
  ok(res, await cancelOrderForBuyer(req.validated.params.id, req.user.id));
}

// Small helper the success page needs: how much delivery costs right now.
export async function getDeliveryConfig(req, res) {
  ok(res, { deliveryFee: env.DELIVERY_FEE, currency: "usd" });
}