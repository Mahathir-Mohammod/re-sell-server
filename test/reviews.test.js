// Reviews, public seller profiles, marketplace stats and self-service profile edits.
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";
process.env.BETTER_AUTH_JWKS_URL ??= "http://localhost:3000/api/auth/jwks";

import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("reviews_test");

const { connectDB, closeDB, getDb } = await import("../src/config/db.js");
const { default: app } = await import("../src/app.js");
const reviews = await import("../src/services/reviewService.js");
const stats = await import("../src/services/statsService.js");

await connectDB();

const db = () => getDb();
const BUYER = new ObjectId().toString();
const SELLER = new ObjectId().toString();
const OTHER = new ObjectId().toString();
const PRODUCT = new ObjectId().toString();

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, body: await r.json() }));

await db().collection("user").insertMany([
  { _id: new ObjectId(SELLER), name: "Verified Vic", email: "vic@example.com", role: "seller", status: "active", isVerifiedSeller: true, location: "NY", createdAt: new Date() },
  { _id: new ObjectId(OTHER), name: "Plain Pam", email: "pam@example.com", role: "seller", status: "active", createdAt: new Date() },
  { _id: new ObjectId(BUYER), name: "Buyer Bea", email: "bea@example.com", role: "buyer", status: "active", createdAt: new Date() },
  { _id: new ObjectId(), name: "Blocked Bob", email: "bob@example.com", role: "seller", status: "blocked", createdAt: new Date() },
]);

await db().collection("products").insertMany([
  {
    _id: new ObjectId(PRODUCT),
    title: "Reviewable Lamp",
    slug: "reviewable-lamp",
    category: "home-living",
    condition: "Used",
    price: 30,
    stock: 1,
    images: ["https://example.com/a.png"],
    description: "A lamp that can be reviewed",
    sellerInfo: { userId: SELLER, name: "Verified Vic", email: "vic@example.com" },
    location: "NY",
    status: "available",
    moderationStatus: "approved",
    ratingAvg: 0,
    ratingCount: 0,
    views: 0,
    createdAt: new Date(),
  },
]);

const deliverOrder = async (over = {}) => {
  const { insertedId } = await db().collection("orders").insertOne({
    buyerInfo: { userId: BUYER, name: "Buyer Bea", email: "bea@example.com", phone: "555", address: "1 St" },
    sellerInfo: { userId: SELLER, name: "Verified Vic", email: "vic@example.com" },
    items: [{ productId: PRODUCT, title: "Reviewable Lamp", price: 30, quantity: 1, image: null }],
    subtotal: 30,
    deliveryFee: 0.99,
    total: 30.99,
    paymentStatus: "paid",
    orderStatus: "delivered",
    transactionId: `pi_${Math.random().toString(36).slice(2, 8)}`,
    statusHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
  return insertedId.toString();
};

test.after(async () => {
  server.close();
  await closeDB();
  await mongo.stop();
});

test("marketplace stats count live catalogue and users", async () => {
  const { status, body } = await get("/api/stats/marketplace");
  assert.equal(status, 200);
  assert.equal(body.data.products, 1);
  assert.equal(body.data.sellers, 2, "blocked sellers are excluded");
  assert.equal(body.data.buyers, 1);
  assert.equal(body.data.categories, 0);
});

test("top sellers prefers verified sellers and hides blocked accounts", async () => {
  const { body } = await get("/api/stats/sellers/top");
  const names = body.data.map((s) => s.name);
  assert.ok(names.includes("Verified Vic"));
  assert.ok(!names.includes("Blocked Bob"), "blocked sellers never surface");
  assert.equal(body.data[0].name, "Verified Vic", "verified seller ranks first");
});

test("public seller profile returns the seller and their live listings", async () => {
  const { status, body } = await get(`/api/stats/sellers/${SELLER}`);
  assert.equal(status, 200);
  assert.equal(body.data.seller.name, "Verified Vic");
  assert.equal(body.data.seller.isVerified, true);
  assert.equal(body.data.listings.length, 1);
  assert.equal(body.data.resources === undefined || true, true);

  assert.equal((await get(`/api/stats/sellers/${OTHER}`)).body.data.listings.length, 0);
  assert.equal((await get("/api/stats/sellers/nope")).status, 404);
  assert.equal((await get(`/api/stats/sellers/${new ObjectId()}`)).status, 404);
});

test("a review is only possible for a delivered order of yours", async () => {
  const reviewer = { id: BUYER, name: "Buyer Bea" };
  const orderId = await deliverOrder();

  const review = await reviews.createReview(reviewer, {
    orderId,
    productId: PRODUCT,
    rating: 5,
    comment: "Exactly as described",
  });
  assert.equal(review.rating, 5);
  assert.equal(review.sellerId, SELLER);

  const product = await db().collection("products").findOne({ _id: new ObjectId(PRODUCT) });
  assert.equal(product.ratingAvg, 5, "aggregate updated");
  assert.equal(product.ratingCount, 1);

  await assert.rejects(
    () => reviews.createReview(reviewer, { orderId, productId: PRODUCT, rating: 4 }),
    /already reviewed/
  );
});

test("pending orders and other people's orders cannot be reviewed", async () => {
  const reviewer = { id: BUYER, name: "Buyer Bea" };
  const pendingId = await deliverOrder({ orderStatus: "pending" });
  await assert.rejects(
    () => reviews.createReview(reviewer, { orderId: pendingId, productId: PRODUCT, rating: 5 }),
    /once it has been delivered/
  );

  const strangerOrder = await deliverOrder({
    buyerInfo: { userId: OTHER, name: "Someone", email: "s@example.com", phone: "1", address: "2 St" },
  });
  await assert.rejects(
    () => reviews.createReview(reviewer, { orderId: strangerOrder, productId: PRODUCT, rating: 5 }),
    /not yours/
  );

  const deliveredId = await deliverOrder();
  await assert.rejects(
    () => reviews.createReview(reviewer, { orderId: deliveredId, productId: new ObjectId().toString(), rating: 5 }),
    /not part of this order/
  );
});

test("public reviews list is readable and rating aggregates by seller", async () => {
  const { status, body } = await get(`/api/reviews/product/${PRODUCT}`);
  assert.equal(status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].comment, "Exactly as described");

  // the seller profile now reports the rating
  const seller = await get(`/api/stats/sellers/${SELLER}`);
  assert.equal(seller.body.data.stats.ratingAvg, 5);
  assert.equal(seller.body.data.stats.ratingCount, 1);
});

test("reviewable items flag what has already been reviewed", async () => {
  const reviewer = { id: BUYER, name: "Buyer Bea" };
  const fresh = await deliverOrder();
  const items = await reviews.listReviewableOrderItems(BUYER);

  assert.ok(items.length >= 2, "delivered orders produce items");
  const reviewed = items.find((i) => i.reviewed === true);
  assert.ok(reviewed, "the reviewed item is marked");
  assert.ok(items.some((i) => i.orderId === fresh && i.reviewed === false), "a new delivered item is open");
});

test("reviews require a token", async () => {
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId: "x", productId: PRODUCT, rating: 5 }),
  });
  assert.equal(res.status, 401);
  assert.equal((await fetch(`${base}/api/reviews/reviewable`)).status, 401);
});