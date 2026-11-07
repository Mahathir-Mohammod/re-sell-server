import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";

// One indexed lookup per request: gives us the live role and blocks blocked users
// immediately instead of waiting for their token to expire.
export async function checkUserStatus(req, res, next) {
  if (!ObjectId.isValid(req.user?.id)) {
    return next(new ApiError(401, "Invalid token subject"));
  }

  const user = await getDb()
    .collection(collections.user)
    .findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { name: 1, email: 1, role: 1, status: 1, image: 1 } }
    );

  if (!user) return next(new ApiError(401, "User not found"));
  if (user.status === "blocked") {
    return next(new ApiError(403, "This account has been blocked"));
  }

  req.user = {
    id: req.user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role ?? "buyer",
    status: user.status ?? "active",
  };
  next();
}