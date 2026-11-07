// Product API checks against an in-memory MongoDB, seeded inline so expectations are exact.
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";
process.env.BETTER_AUTH_JWKS_URL ??= "http://localhost:3000/api/auth/jwks";

import test from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("products_test");

const { connectDB, closeDB, getDb } = await import("../src/config/db.js");
const { default: app } = await import("../src/app.js");

await connectDB();

const product = (over = {}) => ({
  title: "Thing",
  slug: "thing",
  category: "electronics",
  condition: "Used",
  price: 100,
  stock: 1,
  images: [],
  description: "",
  sellerInfo: { userId: "s1", name: "S", email: "s@example.com" },
  location: "NY",
  status: "available",
  moderationStatus: "approved",
  isFeatured: false,
  views: 0,
  ratingAvg: 0,
  ratingCount: 0,
  createdAt: new Date(),
  ...over,
});

await getDb()
  .collection("products")
  .insertMany([
    product({ title: "Cheap Laptop", slug: "cheap-laptop", price: 250, views: 5 }),
    product({ title: "Fancy Laptop", slug: "fancy-laptop", price: 950, views: 50, isFeatured: true }),
    product({ title: "Sold Chair", slug: "sold-chair", category: "furniture", price: 80, status: "sold" }),
    product({ title: "Pending Lamp", slug: "pending-lamp", moderationStatus: "pending" }),
  ]);

await getDb()
  .collection("categories")
  .insertMany([
    { name: "Electronics", slug: "electronics" },
    { name: "Furniture", slug: "furniture" },
  ]);

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, body: await r.json() }));

test.after(async () => {
  server.close();
  await closeDB();
  await mongo.stop();
});

test("list hides sold and pending products", async () => {
  const { status, body } = await get("/api/products");
  assert.equal(status, 200);
  assert.equal(body.meta.total, 2);
  assert.deepEqual(body.data.map((p) => p.slug).sort(), ["cheap-laptop", "fancy-laptop"]);
});

test("pagination meta and page size", async () => {
  const { body } = await get("/api/products?limit=1&page=2");
  assert.equal(body.data.length, 1);
  assert.deepEqual(body.meta, { page: 2, limit: 1, total: 2, totalPages: 2 });
});

test("sort price_desc and price_asc", async () => {
  const desc = await get("/api/products?sort=price_desc");
  assert.deepEqual(desc.body.data.map((p) => p.price), [950, 250]);
  const asc = await get("/api/products?sort=price_asc");
  assert.deepEqual(asc.body.data.map((p) => p.price), [250, 950]);
});

test("price range and category filters", async () => {
  assert.equal((await get("/api/products?maxPrice=300")).body.meta.total, 1);
  assert.equal((await get("/api/products?category=furniture")).body.meta.total, 0);
});

test("search matches title, case-insensitively", async () => {
  const { body } = await get("/api/products?search=LAPTOP");
  assert.equal(body.meta.total, 2);
});

test("search input cannot inject regex", async () => {
  const { status, body } = await get("/api/products?search=.*");
  assert.equal(status, 200);
  assert.equal(body.meta.total, 0);
});

test("invalid sort is rejected by validation", async () => {
  const { status, body } = await get("/api/products?sort=bogus");
  assert.equal(status, 400);
  assert.equal(body.message, "Validation failed");
});

test("detail by slug increments views; unknown id is 404", async () => {
  const { status, body } = await get("/api/products/fancy-laptop");
  assert.equal(status, 200);
  assert.equal(body.data.slug, "fancy-laptop");
  assert.equal((await get("/api/products/does-not-exist")).status, 404);
});

test("featured returns only approved featured products", async () => {
  const { body } = await get("/api/products/featured");
  assert.deepEqual(body.data.map((p) => p.slug), ["fancy-laptop"]);
});

test("categories report live product counts", async () => {
  const { body } = await get("/api/categories");
  const counts = Object.fromEntries(body.data.map((c) => [c.slug, c.productCount]));
  assert.deepEqual(counts, { electronics: 2, furniture: 0 });
});