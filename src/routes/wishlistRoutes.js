import { Router } from "express";
import {
  deleteWishlistItem,
  getWishlist,
  postWishlist,
} from "../controllers/wishlistController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import {
  addWishlistSchema,
  wishlistItemSchema,
  wishlistQuerySchema,
} from "../validators/wishlistValidator.js";

const router = Router();

// buyers, sellers and admins all get a wishlist
router.use(verifyJWT, checkUserStatus);

router.get("/", validate(wishlistQuerySchema), getWishlist);
router.post("/", validate(addWishlistSchema), postWishlist);
router.delete("/:productId", validate(wishlistItemSchema), deleteWishlistItem);

export default router;
