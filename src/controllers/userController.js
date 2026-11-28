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
// Only the fields a user is allowed to edit about themselves. Role and status are
// deliberately absent — those are admin-only.
export async function updateMe(req, res) {
  const patch = req.validated.body;
  const update = { ...patch, updatedAt: new Date() };

  await getDb()
    .collection(collections.user)
    .updateOne({ _id: new ObjectId(req.user.id) }, { $set: update });

  const saved = await getDb()
    .collection(collections.user)
    .findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { name: 1, email: 1, role: 1, image: 1, phone: 1, location: 1, bio: 1, createdAt: 1 } }
    );

  ok(res, { ...saved, id: saved._id.toString() });
}
