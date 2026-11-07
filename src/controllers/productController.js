import { ok } from "../utils/apiResponse.js";
import {
  getProduct,
  listCategories,
  listFeatured,
  listProducts,
  recordView,
} from "../services/productService.js";

export async function getProducts(req, res) {
  const { items, meta } = await listProducts(req.validated.query);
  ok(res, items, meta);
}

export async function getProductById(req, res) {
  const product = await getProduct(req.validated.params.id);
  recordView(product._id);
  ok(res, product);
}

export async function getFeaturedProducts(req, res) {
  ok(res, await listFeatured(Number(req.query.limit) || 8));
}

export async function getCategories(req, res) {
  ok(res, await listCategories());
}