// Phase 0 end-to-end check: real Better Auth (client repo) + real Express API
// against a throwaway in-memory MongoDB. Run: npm run verify:auth
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { runSellerChecks } from "./sellerChecks.mjs";
import { runDashboardChecks } from "./dashboardChecks.mjs";
import { MongoClient } from "mongodb";

const CLIENT_PORT = 3100;
const API_PORT = 5100;
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
const SECRET = randomBytes(32).toString("hex");

const children = [];
let mongo;

function start(cmd, args, cwd, env) {
  // detached so we can kill the whole tree on Windows (npm spawns next/node children)
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });
  child.stdout.on("data", (d) => process.env.VERBOSE && process.stdout.write(d));
  child.stderr.on("data", (d) => process.env.VERBOSE && process.stderr.write(d));
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function assert(cond, message) {
  if (!cond) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

try {
  console.log("1. starting in-memory MongoDB");
  mongo = await MongoMemoryServer.create();
  const MONGODB_URI = mongo.getUri("resell_verify");

  console.log("2. starting Next.js client (better-auth host)");
  start("npm", ["run", "start", "--", "-p", String(CLIENT_PORT)], "../re-sell-client", {
    MONGODB_URI,
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: CLIENT_URL,
    NEXT_PUBLIC_APP_URL: CLIENT_URL,
    AUTH_RATE_LIMIT: "off",
  });
  await waitFor(`${CLIENT_URL}/api/auth/ok`);

  console.log("3. starting Express API");
  start("node", ["src/index.js"], ".", {
    PORT: String(API_PORT),
    MONGODB_URI,
    CLIENT_URL,
    BETTER_AUTH_JWKS_URL: `${CLIENT_URL}/api/auth/jwks`,
  });
  await waitFor(`${API_URL}/api/health`);

  console.log("4. sign-up (role: seller)");
  const signUp = await fetch(`${CLIENT_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: CLIENT_URL },
    body: JSON.stringify({
      name: "Verify Seller",
      email: "verify@example.com",
      password: "password123",
      role: "seller",
    }),
  });
  assert(signUp.ok, `sign-up returned ${signUp.status}`);
  const cookie = signUp.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert(cookie.length > 0, "session cookie issued");

  console.log("5. role escalation is rejected");
  const escalate = await fetch(`${CLIENT_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: CLIENT_URL },
    body: JSON.stringify({
      name: "Sneaky",
      email: "sneaky@example.com",
      password: "password123",
      role: "admin",
    }),
  });
  assert(!escalate.ok, `role:"admin" sign-up rejected (${escalate.status})`);

  console.log("6. JWKS is published");
  const jwks = await (await fetch(`${CLIENT_URL}/api/auth/jwks`)).json();
  assert(Array.isArray(jwks.keys) && jwks.keys.length > 0, "jwks has keys");

  console.log("7. JWT issued for the session");
  const tokenRes = await fetch(`${CLIENT_URL}/api/auth/token`, {
    headers: { cookie },
  });
  const { token } = await tokenRes.json();
  assert(typeof token === "string" && token.split(".").length === 3, "token is a JWT");

  console.log("8. API verifies the JWT and reads the live role");
  const me = await fetch(`${API_URL}/api/users/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await me.json();
  assert(me.status === 200, `/api/users/me returned ${me.status}`);
  assert(body.data.email === "verify@example.com", "email matches");
  assert(body.data.role === "seller", `role is seller (got ${body.data.role})`);

  console.log("9. API rejects a tampered token");
  const bad = await fetch(`${API_URL}/api/users/me`, {
    headers: { authorization: `Bearer ${token.slice(0, -3)}abc` },
  });
  assert(bad.status === 401, `tampered token rejected (${bad.status})`);

  await runSellerChecks({
    API_URL,
    CLIENT_URL,
    MONGODB_URI,
    sellerToken: token,
    sellerId: body.data.id,
    assert,
  });

  await runDashboardChecks({
    API_URL,
    CLIENT_URL,
    MONGODB_URI,
    sellerToken: token,
    sellerId: body.data.id,
    assert,
  });

  console.log("\nPhase 0-6 verified end to end: auth, products, orders, payments, dashboards, wishlist, reviews, profiles.");
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  for (const child of children) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  }
  await mongo?.stop();
  // child processes hold the event loop open; end the script explicitly
  process.exit(process.exitCode ?? 0);
}
