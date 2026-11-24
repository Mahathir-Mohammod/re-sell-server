import { Router } from "express";
import {
  getAdminAnalytics,
  getAdminReports,
  getAdminOrders,
  getAdminPayments,
  getAdminProducts,
  getAdminStats,
  getAdminUsers,
  patchAdminOrderStatus,
  patchAdminProduct,
  patchAdminReport,
  patchAdminSellerVerify,
  patchAdminUser,
  removeAdminProduct,
  removeAdminUser,
} from "../controllers/adminController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import { requireRole } from "../middleware/requireRole.js";
import { productIdSchema } from "../validators/productValidator.js";
import { orderIdSchema } from "../validators/orderValidator.js";
import {
  adminOrdersSchema,
  adminPaymentsSchema,
  adminStatusSchema,
  adminUserIdSchema,
  adminUserPatchSchema,
  adminUsersSchema,
  adminProductsSchema,
  moderateProductSchema,
  verifySellerSchema,
} from "../validators/adminValidator.js";
import { reportIdSchema, reportListSchema, resolveReportSchema } from "../validators/reportValidator.js";

const router = Router();

// every admin route needs a live admin — the guard is applied once, not per route
router.use(verifyJWT, checkUserStatus, requireRole("admin"));

router.get("/stats", getAdminStats);
router.get("/analytics", getAdminAnalytics);

router.get("/users", validate(adminUsersSchema), getAdminUsers);
router.patch("/users/:id", validate(adminUserIdSchema), validate(adminUserPatchSchema), patchAdminUser);
router.delete("/users/:id", validate(adminUserIdSchema), removeAdminUser);

router.get("/products", validate(adminProductsSchema), getAdminProducts);
router.patch("/products/:id", validate(productIdSchema), validate(moderateProductSchema), patchAdminProduct);
router.delete("/products/:id", validate(productIdSchema), removeAdminProduct);

router.get("/orders", validate(adminOrdersSchema), getAdminOrders);
router.patch("/orders/:id", validate(orderIdSchema), validate(adminStatusSchema), patchAdminOrderStatus);

router.get("/payments", validate(adminPaymentsSchema), getAdminPayments);

router.get("/reports", validate(reportListSchema), getAdminReports);
router.patch("/reports/:id", validate(reportIdSchema), validate(resolveReportSchema), patchAdminReport);

router.patch("/sellers/:id/verify", validate(adminUserIdSchema), validate(verifySellerSchema), patchAdminSellerVerify);

export default router;