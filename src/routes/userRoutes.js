import { Router } from "express";
import { getMe } from "../controllers/userController.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";

const router = Router();

router.get("/me", verifyJWT, checkUserStatus, getMe);

export default router;