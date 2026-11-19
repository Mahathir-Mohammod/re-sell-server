import { Router } from "express";
import {
  getFeaturedProducts,
  getMyProducts,
  getProductById,
  getProducts,
  patchProduct,
  postProduct,
  postUpload,
  removeProduct,
} from "../controllers/productController.js";
import { validate } from "../middleware/validate.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  createProductSchema,
  listProductsSchema,
  myProductsSchema,
  productIdSchema,
  updateProductSchema,
  uploadSchema,
} from "../validators/productValidator.js";

const router = Router();

// public
router.get("/featured", getFeaturedProducts);
router.get("/", validate(listProductsSchema), getProducts);

// seller + admin. Registered before "/:id" so "/mine" isn't read as an id.
const seller = [verifyJWT, checkUserStatus, requireRole("seller", "admin")];

router.get("/mine", seller, validate(myProductsSchema), getMyProducts);
router.post("/upload", seller, validate(uploadSchema), postUpload);
router.post("/", seller, validate(createProductSchema), postProduct);
router.patch("/:id", seller, validate(productIdSchema), validate(updateProductSchema), patchProduct);
router.delete("/:id", seller, validate(productIdSchema), removeProduct);

router.get("/:id", validate(productIdSchema), getProductById);

export default router;