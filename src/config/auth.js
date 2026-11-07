import { createRemoteJWKSet } from "jose";
import { env } from "./env.js";

// Better Auth (Next.js) publishes its public keys here. Remote set caches keys
// and refetches on unknown `kid`, so key rotation needs no restart.
export const JWKS = createRemoteJWKSet(new URL(env.BETTER_AUTH_JWKS_URL), {
  cacheMaxAge: 10 * 60 * 1000,
});

export const jwtVerifyOptions = {
  ...(env.BETTER_AUTH_ISSUER && { issuer: env.BETTER_AUTH_ISSUER }),
  ...(env.BETTER_AUTH_AUDIENCE && { audience: env.BETTER_AUTH_AUDIENCE }),
};