import { Router } from "express";
import {
  getSellerAnalytics,
  getSellerOrderById,
  getSellerOrders,
  getSellerStats,
  patchSellerOrderStatus,
} from "../controllers/sellerController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import { requireRole } from "../middleware/requireRole.js";
import { orderIdSchema, updateStatusSchema } from "../validators/orderValidator.js";
import { sellerOrdersSchema } from "../validators/adminValidator.js";

const router = Router();

router.use(verifyJWT, checkUserStatus, requireRole("seller", "admin"));

router.get("/orders", validate(sellerOrdersSchema), getSellerOrders);
router.get("/orders/:id", validate(orderIdSchema), getSellerOrderById);
router.patch("/orders/:id/status", validate(orderIdSchema), validate(updateStatusSchema), patchSellerOrderStatus);

router.get("/stats", getSellerStats);
router.get("/analytics", getSellerAnalytics);

export default router;