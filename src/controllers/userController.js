import { ok } from "../utils/apiResponse.js";

// Proof slice for Phase 0: verifies JWT -> DB lookup -> role available on req.user.
export async function getMe(req, res) {
  ok(res, req.user);
}