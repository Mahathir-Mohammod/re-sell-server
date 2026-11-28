import { Router } from "express";
import { getSeller, getStats, getTopSellers } from "../controllers/statsController.js";

const router = Router();

router.get("/marketplace", getStats);
router.get("/sellers/top", getTopSellers);
// no param validator: the service answers 404 for both malformed and unknown ids,
// which is what a browser deep-link should see
router.get("/sellers/:id", getSeller);

export default router;
