// Admin moderation, seller order transitions and analytics — in-memory Mongo, no network.
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";
process.env.BETTER_AUTH_JWKS_URL ??= "http://localhost:3000/api/auth/jwks";

import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("dashboard_test");

const { connectDB, closeDB, getDb } = await import("../src/config/db.js");
const { default: app } = await import("../src/app.js");
const admin = await import("../src/services/adminService.js");
const seller = await import("../src/services/sellerService.js");
const analytics = await import("../src/services/analyticsService.js");
const { transitionOrder, assertTransition } = await import("../src/services/orderService.js");

await connectDB();

const db = () => getDb();
const oid = (n) => new ObjectId(String(n).padStart(24, "0"));
const SELLER = oid(1).toString();
const OTHER = oid(2).toString();
const BUYER = oid(3).toString();
const ADMIN_ID = oid(4).toString();

const product = (over = {}) => ({
  title: "Thing",
  slug: `thing-${Math.random().toString(36).slice(2, 8)}`,
  category: "electronics",
  condition: "Used",
  price: 50,
  stock: 3,
  images: ["https://example.com/a.png"],
  description: "A thing worth buying",
  sellerInfo: { userId: SELLER, name: "Seller", email: "s@example.com", phone: "" },
  location: "NY",
  status: "available",
  moderationStatus: "approved",
  isFeatured: false,
  views: 0,
  ratingAvg: 0,
  ratingCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const order = (over = {}) => ({
  buyerInfo: { userId: BUYER, name: "Buyer", email: "b@example.com", phone: "555", address: "1 St" },
  sellerInfo: { userId: SELLER, name: "Seller", email: "s@example.com" },
  items: [{ productId: "p1", title: "Thing", price: 50, quantity: 1, image: null }],
  subtotal: 50,
  deliveryFee: 0.99,
  total: 50.99,
  paymentStatus: "paid",
  orderStatus: "pending",
  transactionId: `pi_${Math.random().toString(36).slice(2, 8)}`,
  statusHistory: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const fakeStripe = (refunds = []) => ({
  refunds: {
    create: async (params) => {
      refunds.push(params);
      return { id: "re_test", status: "succeeded" };
    },
  },
});

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, body: await r.json() }));

test.after(async () => {
  server.close();
  await closeDB();
  await mongo.stop();
});

// ------------------------------------------------------------------ moderation

test("admin product list filters moderation queue", async () => {
  await db().collection("products").insertMany([
    product({ title: "Waiting", slug: "waiting", moderationStatus: "pending" }),
    product({ title: "Live", slug: "live" }),
  ]);

  const pending = await admin.listAdminProducts({ moderationStatus: "pending" });
  assert.equal(pending.meta.total, 1);
  assert.equal(pending.items[0].slug, "waiting");

  // the public catalogue must not show it yet
  const publicList = await get("/api/products");
  assert.ok(!publicList.body.data.some((p) => p.slug === "waiting"));
});

test("approving a listing makes it public immediately", async () => {
  const created = await admin.listAdminProducts({ search: "waiting" });
  const approved = await admin.moderateProduct(created.items[0]._id.toString(), { moderationStatus: "approved" });
  assert.equal(approved.moderationStatus, "approved");
  assert.ok(approved.moderatedAt instanceof Date);

  const publicList = await get("/api/products?search=waiting");
  assert.equal(publicList.body.meta.total, 1);

  // moderation button must work with slugs too? no — ids only, and a bad one 404s
  await assert.rejects(() => admin.moderateProduct("nope", { moderationStatus: "approved" }), /not found/);
});

test("admin deleting a product removes it from the catalogue", async () => {
  const target = await admin.listAdminProducts({ search: "live" });
  await admin.deleteProductAsAdmin(target.items[0]._id.toString());
  const after = await get("/api/products?search=live");
  assert.equal(after.body.meta.total, 0);
});

// ------------------------------------------------------------------ users

test("admin user list searches name/email and hides nothing sensitive", async () => {
  await db().collection("user").insertMany([
    { _id: new ObjectId(ADMIN_ID), name: "Root", email: "admin@resell.test", role: "admin", status: "active", createdAt: new Date() },
    { _id: new ObjectId(SELLER), name: "Ayesha", email: "ayesha@seller.test", role: "seller", status: "active", createdAt: new Date() },
    { _id: new ObjectId(OTHER), name: "Marcus", email: "marcus@seller.test", role: "seller", status: "active", createdAt: new Date() },
  ]);

  const found = await admin.listAdminUsers({ search: "ayesha" });
  assert.equal(found.meta.total, 1);
  assert.equal(found.items[0].email, "ayesha@seller.test");
  assert.equal(found.items[0].password, undefined);

  const admins = await admin.listAdminUsers({ role: "admin" });
  assert.equal(admins.meta.total, 1);
});

test("blocking a user flips status; self edits and last-admin demotion are refused", async () => {
  const blocked = await admin.updateAdminUser(OTHER, { status: "blocked" }, ADMIN_ID);
  assert.equal(blocked.status, "blocked");
  const reloaded = await admin.listAdminUsers({ search: "marcus" });
  assert.equal(reloaded.items[0].status, "blocked");

  await assert.rejects(() => admin.updateAdminUser(ADMIN_ID, { role: "buyer" }, ADMIN_ID), /your own account/);
  await assert.rejects(
    () => admin.updateAdminUser(ADMIN_ID, { role: "buyer" }, OTHER),
    /last admin/
  );
});

test("deleting a user clears their auth rows and unsells their listings", async () => {
  const targetId = OTHER;
  await db().collection("session").insertOne({ _id: new ObjectId(), userId: targetId, token: "t" });
  await db().collection("account").insertOne({ _id: new ObjectId(), userId: targetId, providerId: "credential" });
  await db().collection("products").insertOne(
    product({ title: "Orphan", slug: "orphan", sellerInfo: { userId: targetId, name: "Marcus", email: "m@seller.test" } })
  );

  await admin.deleteAdminUser(targetId, ADMIN_ID);

  assert.equal(await db().collection("user").countDocuments({ _id: new ObjectId(targetId) }), 0);
  assert.equal(await db().collection("session").countDocuments({ userId: targetId }), 0);
  assert.equal(await db().collection("account").countDocuments({ userId: targetId }), 0);
  const orphan = await db().collection("products").findOne({ slug: "orphan" });
  assert.equal(orphan.status, "unavailable");

  await assert.rejects(() => admin.deleteAdminUser(ADMIN_ID, ADMIN_ID), /your own account/);
});

// ------------------------------------------------------------------ seller orders

test("seller sees only their own orders", async () => {
  await db().collection("orders").insertMany([
    order({ orderStatus: "pending" }),
    order({ sellerInfo: { userId: OTHER, name: "Other", email: "o@x.com" }, orderStatus: "pending" }),
  ]);

  const mine = await seller.listSellerOrders(SELLER, {});
  assert.equal(mine.meta.total, 1);
  assert.equal(mine.items[0].sellerInfo.userId, SELLER);

  const filtered = await seller.listSellerOrders(SELLER, { status: "delivered" });
  assert.equal(filtered.meta.total, 0);
});

test("seller moves an order through the allowed transitions only", async () => {
  const { _id } = await db().collection("orders").findOne({ "sellerInfo.userId": SELLER });
  const user = { id: SELLER, role: "seller" };

  const accepted = await seller.updateSellerOrderStatus(_id.toString(), user, "accepted");
  assert.equal(accepted.orderStatus, "accepted");

  // skipped step is rejected by the shared transition map
  await assert.rejects(
    () => seller.updateSellerOrderStatus(_id.toString(), user, "delivered"),
    /Cannot go from accepted to delivered/
  );

  await seller.updateSellerOrderStatus(_id.toString(), user, "processing");
  await seller.updateSellerOrderStatus(_id.toString(), user, "shipped");
  const delivered = await seller.updateSellerOrderStatus(_id.toString(), user, "delivered");
  assert.equal(delivered.orderStatus, "delivered");

  const saved = await db().collection("orders").findOne({ _id });
  assert.deepEqual(
    saved.statusHistory.map((h) => h.status),
    ["accepted", "processing", "shipped", "delivered"]
  );
});

test("another seller cannot touch the order", async () => {
  const { _id } = await db().collection("orders").findOne({ "sellerInfo.userId": SELLER });
  await assert.rejects(
    () => seller.updateSellerOrderStatus(_id.toString(), { id: OTHER, role: "seller" }, "cancelled"),
    /not for your listings/
  );
});

test("rejecting a paid order refunds and restores stock", async () => {
  const product_ = await db().collection("products").findOne({ slug: "live" });
  assert.equal(product_, null, "fixture was deleted earlier");

  const stockTarget = await db()
    .collection("products")
    .insertOne(product({ title: "Refundable", slug: "refundable", stock: 0, status: "sold" }));

  const { insertedId } = await db()
    .collection("orders")
    .insertOne(
      order({
        items: [{ productId: stockTarget.insertedId.toString(), title: "Refundable", price: 50, quantity: 1, image: null }],
        orderStatus: "pending",
        paymentStatus: "paid",
      })
    );

  const refunds = [];
  const rejected = await transitionOrder(
    await db().collection("orders").findOne({ _id: insertedId }),
    "rejected",
    SELLER,
    { stripe: fakeStripe(refunds) }
  );

  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amount, 5099);
  assert.equal(rejected.paymentStatus, "refunded");

  const saved = await db().collection("orders").findOne({ _id: insertedId });
  assert.equal(saved.orderStatus, "rejected");
  assert.equal(saved.paymentStatus, "refunded");
  assert.equal((await db().collection("products").findOne({ _id: stockTarget.insertedId })).stock, 1);
});

test("transitionOrder never invents a move", () => {
  assert.throws(() => assertTransition("cancelled", "accepted"), /can no longer change status/);
});

// ------------------------------------------------------------------ analytics

test("seller stats add up paid revenue and units", async () => {
  const stats = await seller.sellerStats(SELLER);
  assert.equal(stats.totalProducts, 2, "two listings inserted for this seller");
  assert.ok(stats.revenue > 0);
  assert.ok(stats.unitsSold > 0);
  assert.equal(typeof stats.averageOrderValue, "number");
  assert.ok(stats.orders >= 1);
});

test("seller analytics fills six month buckets and ranks products", async () => {
  const data = await analytics.sellerAnalytics(SELLER);
  assert.equal(data.monthly.length, 6);
  for (const row of data.monthly) {
    assert.match(row.month, /^\d{4}-\d{2}$/);
    assert.equal(typeof row.revenue, "number");
  }
  assert.ok(data.topProducts.length >= 1);
  assert.ok(data.topProducts[0].units >= 1);
  assert.ok(data.byStatus.length >= 1);
});

test("admin analytics and stats report platform totals", async () => {
  await db().collection("payments").insertOne({
    transactionId: "pi_stats_1",
    buyerId: BUYER,
    amount: 50.99,
    refundedAmount: 0,
    status: "paid",
    method: "stripe",
    createdAt: new Date(),
  });

  const data = await analytics.adminAnalytics();
  assert.equal(data.monthly.length, 6);
  assert.equal(data.signups.length, 6);
  assert.ok(data.topCategories.length >= 1);

  const stats = await admin.adminStats();
  assert.equal(stats.users.total, 2, "admin + seller remain after the delete test");
  assert.equal(stats.users.byRole.seller, 1);
  assert.equal(stats.users.byRole.admin, 1);
  assert.equal(stats.users.byRole.buyer, 0, "empty roles are reported as zero, not missing");
  assert.equal(stats.products.total, 3);
  assert.equal(stats.products.byModeration.pending, 0);
  assert.ok(stats.orders.total >= 1);
  assert.ok(stats.revenue.gross > 0);
  assert.ok(stats.revenue.net <= stats.revenue.gross);
});

test("admin payments list exposes a revenue summary", async () => {
  await db().collection("payments").insertOne({
    transactionId: "pi_admin_1",
    buyerId: BUYER,
    amount: 50.99,
    refundedAmount: 0,
    status: "paid",
    method: "stripe",
    createdAt: new Date(),
  });

  const { items, meta, summary } = await admin.listAdminPayments({ search: "pi_admin_1" });
  assert.equal(items.length, 1);
  assert.equal(meta.total, 1);
  assert.deepEqual(summary, { count: 1, gross: 50.99, refunded: 0, net: 50.99 });});

test("admin routes are closed without a token", async () => {
  for (const path of ["/api/admin/stats", "/api/admin/users", "/api/admin/products", "/api/seller/orders"]) {
    const { status, body } = await get(path);
    assert.equal(status, 401, path);
    assert.equal(body.success, false);
  }
});