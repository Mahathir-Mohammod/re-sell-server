import { ok, created } from "../utils/apiResponse.js";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listCategories,
  listFeatured,
  listProducts,
  listSellerProducts,
  recordView,
  updateProduct,
} from "../services/productService.js";
import { uploadImage } from "../services/uploadService.js";

export async function getProducts(req, res) {
  const { items, meta } = await listProducts(req.validated.query);
  ok(res, items, meta);
}

export async function getMyProducts(req, res) {
  const { items, meta } = await listSellerProducts(req.user.id, req.validated.query);
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

export async function postProduct(req, res) {
  created(res, await createProduct(req.user, req.validated.body));
}

export async function patchProduct(req, res) {
  ok(res, await updateProduct(req.validated.params.id, req.user, req.validated.body));
}

export async function removeProduct(req, res) {
  ok(res, await deleteProduct(req.validated.params.id, req.user));
}

export async function postUpload(req, res) {
  const { image, name } = req.validated.body;
  ok(res, { url: await uploadImage(image, name) });
}