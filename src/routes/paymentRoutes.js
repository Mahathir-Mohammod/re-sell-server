import { Router } from "express";
import {
  confirm,
  createIntent,
  getPayment,
  myPayments,
  webhook,
} from "../controllers/paymentController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import { confirmPaymentSchema, orderIdSchema } from "../validators/orderValidator.js";
import { createIntentSchema } from "../validators/orderValidator.js";

const router = Router();
const auth = [verifyJWT, checkUserStatus];

router.post("/create-intent", auth, validate(createIntentSchema), createIntent);
router.post("/confirm", auth, validate(confirmPaymentSchema), confirm);
router.get("/my", auth, myPayments);
router.get("/:id", auth, validate(orderIdSchema), getPayment);

// The webhook is mounted in app.js (raw body) and routed here afterwards.
router.post("/webhook", webhook);

export default router;