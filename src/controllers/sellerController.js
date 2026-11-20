import { ok } from "../utils/apiResponse.js";
import {
  getSellerOrder,
  listSellerOrders,
  sellerStats,
  updateSellerOrderStatus,
} from "../services/sellerService.js";
import { sellerAnalytics } from "../services/analyticsService.js";

export async function getSellerOrders(req, res) {
  const { items, meta } = await listSellerOrders(req.user.id, req.validated.query);
  ok(res, items, meta);
}

export async function getSellerOrderById(req, res) {
  ok(res, await getSellerOrder(req.validated.params.id, req.user));
}

export async function patchSellerOrderStatus(req, res) {
  ok(res, await updateSellerOrderStatus(req.validated.params.id, req.user, req.validated.body.status));
}

export async function getSellerStats(req, res) {
  ok(res, await sellerStats(req.user.id));
}

export async function getSellerAnalytics(req, res) {
  ok(res, await sellerAnalytics(req.user.id));
}