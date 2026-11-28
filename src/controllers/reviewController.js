import { created, ok } from "../utils/apiResponse.js";
import {
  createReview,
  listProductReviews,
  listReviewableOrderItems,
  myReviews,
} from "../services/reviewService.js";

export async function getProductReviews(req, res) {
  ok(res, await listProductReviews(req.validated.params.id));
}

export async function postReview(req, res) {
  created(res, await createReview(req.user, req.validated.body));
}

export async function getReviewableItems(req, res) {
  ok(res, await listReviewableOrderItems(req.user.id));
}

export async function getMyReviews(req, res) {
  const { items, meta } = await myReviews(req.user.id, req.validated.query);
  ok(res, items, meta);
}
