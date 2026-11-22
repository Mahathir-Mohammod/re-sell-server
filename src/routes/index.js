import { Router } from "express";
import { getHealth } from "../controllers/healthController.js";
import { getCategories } from "../controllers/productController.js";
import userRoutes from "./userRoutes.js";
import productRoutes from "./productRoutes.js";
import orderRoutes from "./orderRoutes.js";
import paymentRoutes from "./paymentRoutes.js";
import adminRoutes from "./adminRoutes.js";
import sellerRoutes from "./sellerRoutes.js";
import wishlistRoutes from "./wishlistRoutes.js";

const router = Router();

router.get("/health", getHealth);
router.use("/users", userRoutes);
router.use("/products", productRoutes);
router.use("/orders", orderRoutes);
router.use("/payments", paymentRoutes);
router.use("/admin", adminRoutes);
router.use("/seller", sellerRoutes);
router.use("/wishlist", wishlistRoutes);
router.get("/categories", getCategories);

export default router;