import { Router } from "express";
import { cancelOrder, getDeliveryConfig, getMyOrders, getOrder } from "../controllers/orderController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import { myOrdersSchema, orderIdSchema } from "../validators/orderValidator.js";

const router = Router();
const auth = [verifyJWT, checkUserStatus];

router.get("/my", auth, validate(myOrdersSchema), getMyOrders);
router.get("/config", getDeliveryConfig);
router.get("/:id", auth, validate(orderIdSchema), getOrder);
router.patch("/:id/cancel", auth, validate(orderIdSchema), cancelOrder);

export default router;