import { Router } from "express";
import { becomeSeller, getMe } from "../controllers/userController.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";

const router = Router();

router.get("/me", verifyJWT, checkUserStatus, getMe);
router.patch("/become-seller", verifyJWT, checkUserStatus, becomeSeller);

export default router;