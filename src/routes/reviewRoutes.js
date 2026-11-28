import { Router } from "express";
import {
  getMyReviews,
  getProductReviews,
  getReviewableItems,
  postReview,
} from "../controllers/reviewController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import {
  createReviewSchema,
  myReviewsSchema,
  productIdParamSchema,
} from "../validators/reviewValidator.js";

const router = Router();

router.get("/product/:id", validate(productIdParamSchema), getProductReviews);

router.get("/mine", verifyJWT, checkUserStatus, validate(myReviewsSchema), getMyReviews);
router.get("/reviewable", verifyJWT, checkUserStatus, getReviewableItems);
router.post("/", verifyJWT, checkUserStatus, validate(createReviewSchema), postReview);

export default router;
