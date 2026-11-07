import { jwtVerify } from "jose";
import { JWKS, jwtVerifyOptions } from "../config/auth.js";
import { ApiError } from "../utils/ApiError.js";

// Signature check only (no DB). checkUserStatus loads the live role/status.
// Express 5 forwards rejected promises to the error handler, so no asyncHandler wrapper.
export async function verifyJWT(req, res, next) {
  const [scheme, token] = (req.get("authorization") || "").split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new ApiError(401, "Missing bearer token"));
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, jwtVerifyOptions);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired token"));
  }
}