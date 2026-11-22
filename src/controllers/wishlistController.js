import { created, ok } from "../utils/apiResponse.js";
import {
  addToWishlist,
  listWishlist,
  removeFromWishlist,
} from "../services/wishlistService.js";

export async function getWishlist(req, res) {
  const { items, meta } = await listWishlist(req.user.id, req.validated.query);
  ok(res, items, meta);
}

export async function postWishlist(req, res) {
  created(res, await addToWishlist(req.user.id, req.validated.body.productId));
}

export async function deleteWishlistItem(req, res) {
  ok(res, await removeFromWishlist(req.user.id, req.validated.params.productId));
}
