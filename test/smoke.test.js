// Smoke checks for Phase 0 wiring: no DB needed, only route/auth middleware behaviour.
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/resell_test";
process.env.BETTER_AUTH_JWKS_URL ??= "http://localhost:3000/api/auth/jwks";

import test from "node:test";
import assert from "node:assert/strict";

// dynamic import so the env fallbacks above apply before config/env.js is evaluated
const { default: app } = await import("../src/app.js");

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

test("protected route rejects a missing token", async () => {
  const res = await fetch(`${base}/api/users/me`);
  assert.equal(res.status, 401);
  assert.match((await res.json()).message, /bearer token/i);
});

test("protected route rejects a garbage token", async () => {
  const res = await fetch(`${base}/api/users/me`, {
    headers: { authorization: "Bearer not-a-jwt" },
  });
  assert.equal(res.status, 401);
});

test("unknown route returns JSON 404", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).success, false);
});

test("malformed JSON body returns 400", async () => {
  const res = await fetch(`${base}/api/users/me`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(res.status, 400);
});