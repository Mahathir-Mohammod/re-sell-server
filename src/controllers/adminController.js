import { ok } from "../utils/apiResponse.js";
import {
  adminStats,
  deleteAdminUser,
  deleteProductAsAdmin,
  listAdminOrders,
  listAdminPayments,
  listAdminProducts,
  listAdminUsers,
  moderateProduct,
  setSellerVerified,
  updateAdminUser,
  updateOrderStatusAsAdmin,
} from "../services/adminService.js";
import { adminAnalytics } from "../services/analyticsService.js";
import { listReports, resolveReport } from "../services/reportService.js";

export async function getAdminStats(req, res) {
  ok(res, await adminStats());
}

// products
export async function getAdminProducts(req, res) {
  const { items, meta } = await listAdminProducts(req.validated.query);
  ok(res, items, meta);
}

export async function patchAdminProduct(req, res) {
  ok(res, await moderateProduct(req.validated.params.id, req.validated.body));
}

export async function removeAdminProduct(req, res) {
  ok(res, await deleteProductAsAdmin(req.validated.params.id));
}

// users
export async function getAdminUsers(req, res) {
  const { items, meta } = await listAdminUsers(req.validated.query);
  ok(res, items, meta);
}

export async function patchAdminUser(req, res) {
  ok(res, await updateAdminUser(req.validated.params.id, req.validated.body, req.user.id));
}

export async function removeAdminUser(req, res) {
  ok(res, await deleteAdminUser(req.validated.params.id, req.user.id));
}

// orders
export async function getAdminOrders(req, res) {
  const { items, meta } = await listAdminOrders(req.validated.query);
  ok(res, items, meta);
}

export async function patchAdminOrderStatus(req, res) {
  ok(res, await updateOrderStatusAsAdmin(req.validated.params.id, req.validated.body.status, req.user.id));
}

// payments
export async function getAdminPayments(req, res) {
  const { items, meta, summary } = await listAdminPayments(req.validated.query);
  ok(res, items, { ...meta, summary });
}

export async function getAdminAnalytics(req, res) {
  ok(res, await adminAnalytics());
}

// reports
export async function getAdminReports(req, res) {
  const { items, meta } = await listReports(req.validated.query);
  ok(res, items, meta);
}

export async function patchAdminReport(req, res) {
  ok(res, await resolveReport(req.validated.params.id, req.validated.body.status, req.user.id));
}

// sellers
export async function patchAdminSellerVerify(req, res) {
  ok(res, await setSellerVerified(req.validated.params.id, req.validated.body.verified));
}
