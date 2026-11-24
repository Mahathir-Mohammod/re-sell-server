import { Router } from "express";
import { postReport } from "../controllers/reportController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import { createReportSchema } from "../validators/reportValidator.js";

const router = Router();

// open to any signed-in user; admins read and resolve reports under /api/admin
router.post("/", verifyJWT, checkUserStatus, validate(createReportSchema), postReport);

export default router;
