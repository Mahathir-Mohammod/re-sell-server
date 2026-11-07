import { Router } from "express";
import {
  getFeaturedProducts,
  getProductById,
  getProducts,
} from "../controllers/productController.js";
import { validate } from "../middleware/validate.js";
import {
  listProductsSchema,
  productIdSchema,
} from "../validators/productValidator.js";

const router = Router();

// literal paths before "/:id" so they aren't swallowed by the param route
router.get("/featured", getFeaturedProducts);
router.get("/", validate(listProductsSchema), getProducts);
router.get("/:id", validate(productIdSchema), getProductById);

export default router;