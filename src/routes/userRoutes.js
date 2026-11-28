import { Router } from "express";
import { becomeSeller, getMe, updateMe } from "../controllers/userController.js";
import { validate } from "../middleware/validate.js";
import { updateMeSchema } from "../validators/userValidator.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";

const router = Router();

router.get("/me", verifyJWT, checkUserStatus, getMe);
router.patch("/become-seller", verifyJWT, checkUserStatus, becomeSeller);
router.patch("/me", verifyJWT, checkUserStatus, validate(updateMeSchema), updateMe);

export default router;