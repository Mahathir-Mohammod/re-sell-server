import { Router } from "express";
import { getHealth } from "../controllers/healthController.js";
import { getCategories } from "../controllers/productController.js";
import userRoutes from "./userRoutes.js";
import productRoutes from "./productRoutes.js";

const router = Router();

router.get("/health", getHealth);
router.use("/users", userRoutes);
router.use("/products", productRoutes);
router.get("/categories", getCategories);

export default router;