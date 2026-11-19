import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ok } from "../utils/apiResponse.js";

// Proof slice for Phase 0: verifies JWT -> DB lookup -> role available on req.user.
export async function getMe(req, res) {
  ok(res, req.user);
}

// Buyers may upgrade to seller once; admins/sellers are a no-op.
export async function becomeSeller(req, res) {
  if (req.user.role === "buyer") {
    await getDb()
      .collection(collections.user)
      .updateOne(
        { _id: new ObjectId(req.user.id) },
        { $set: { role: "seller", updatedAt: new Date() } }
      );
    req.user.role = "seller";
  }
  ok(res, { role: req.user.role });
}