// Pricing, transition rules and the Stripe webhook — all offline (fake events, local signature).
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";
process.env.BETTER_AUTH_JWKS_URL ??= "http://localhost:3000/api/auth/jwks";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_signature_checks";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { MongoMemoryServer } from "mongodb-memory-server";

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("payments_test");

const { connectDB, closeDB, getDb } = await import("../src/config/db.js");
const { default: app } = await import("../src/app.js");
const { computeTotals, grandTotalCents, groupBySeller } = await import("../src/services/pricingService.js");
const { canTransition, assertTransition, priceCart, createPendingOrders, TRANSITIONS } =
  await import("../src/services/orderService.js");
const { handleWebhookEvent, applySuccessfulPayment } = await import("../src/services/paymentService.js");

await connectDB();

const SELLER_A = "64b000000000000000000000a1";
const SELLER_B = "64b000000000000000000000b1";
const BUYER = "64b000000000000000000000c1";

const insertProduct = (over) =>
  getDb()
    .collection("products")
    .insertOne({
      title: "Thing",
      slug: `thing-${Math.random().toString(36).slice(2, 8)}`,
      category: "electronics",
      condition: "Used",
      price: 10,
      stock: 5,
      images: ["https://example.com/a.png"],
      description: "x",
      sellerInfo: { userId: SELLER_A, name: "A", email: "a@example.com", phone: "" },
      status: "available",
      moderationStatus: "approved",
      createdAt: new Date(),
      ...over,
    });

test("groupBySeller splits a cart per seller", () => {
  const groups = groupBySeller([
    { productId: "1", title: "a", price: 10, quantity: 1, sellerId: SELLER_A },
    { productId: "2", title: "b", price: 20, quantity: 2, sellerId: SELLER_B },
    { productId: "3", title: "c", price: 5, quantity: 1, sellerId: SELLER_A },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.sellerInfo.userId === SELLER_A).items.length, 2);
});

test("delivery fee is charged once per seller and totals add up in cents", () => {
  const groups = groupBySeller([
    { productId: "1", title: "a", price: 19.99, quantity: 2, sellerId: SELLER_A },
    { productId: "2", title: "b", price: 5, quantity: 1, sellerId: SELLER_B },
  ]);
  const totals = computeTotals(groups, 0.99);

  const a = totals.find((t) => t.sellerInfo.userId === SELLER_A);
  assert.equal(a.subtotal, 39.98);
  assert.equal(a.deliveryFee, 0.99);
  assert.equal(a.total, 40.97);

  const summary = grandTotalCents(totals);
  assert.deepEqual(summary, { subtotal: 4498, delivery: 198, total: 4696 });
});

test("no delivery fee on an empty group (guards a zero subtotal)", () => {
  const totals = computeTotals([{ sellerInfo: { userId: "x" }, items: [] }], 0.99);
  assert.equal(totals[0].deliveryFee, 0);
  assert.equal(totals[0].total, 0);
});

test("transition map only allows the documented moves", () => {
  assert.equal(canTransition("pending", "accepted"), true);
  assert.equal(canTransition("pending", "delivered"), false);
  assert.equal(canTransition("shipped", "delivered"), true);
  assert.equal(canTransition("delivered", "shipped"), false);
  assert.equal(canTransition("cancelled", "pending"), false);
  assert.deepEqual([...TRANSITIONS.pending].sort(), ["accepted", "cancelled", "rejected"].sort());
  assert.throws(() => assertTransition("delivered", "cancelled"), /can no longer change status/);
  assert.throws(() => assertTransition("pending", "delivered"), /Allowed: accepted, rejected, cancelled/);
});

test("priceCart ignores client prices and rejects bad carts", async () => {
  const own = await insertProduct({ title: "Own item", price: 5, sellerInfo: { userId: BUYER, name: "me" } });
  const sold = await insertProduct({ title: "Sold item", price: 5, status: "sold" });
  const thin = await insertProduct({ title: "Scarce", price: 5, stock: 1 });
  const good = await insertProduct({ title: "Good", price: 12.5, stock: 4 });

  const { groups, summary } = await priceCart(
    BUYER,
    [{ productId: good.insertedId.toString(), quantity: 2, price: 0.01 }],
    0.99
  );
  assert.equal(groups[0].items[0].price, 12.5, "price comes from the DB, not the client");
  assert.equal(summary.total, 2599); // 12.50 * 2 + 0.99

  await assert.rejects(
    () => priceCart(BUYER, [{ productId: own.insertedId.toString(), quantity: 1 }], 0.99),
    /cannot buy your own listing/
  );
  await assert.rejects(
    () => priceCart(BUYER, [{ productId: sold.insertedId.toString(), quantity: 1 }], 0.99),
    /no longer available/
  );
  await assert.rejects(
    () => priceCart(BUYER, [{ productId: thin.insertedId.toString(), quantity: 3 }], 0.99),
    /Only 1 left/
  );
  await assert.rejects(
    () => priceCart(BUYER, [{ productId: "not-an-id", quantity: 1 }], 0.99),
    /invalid/
  );

  await assert.rejects(
    () => priceCart(BUYER, [{ productId: good.insertedId.toString(), quantity: 0 }], 0.99),
    /Invalid quantity/
  );
  await assert.rejects(
    () => priceCart(BUYER, [{ productId: good.insertedId.toString(), quantity: 99 }], 0.99),
    /Invalid quantity/
  );
});

test("successful payment marks orders paid, decrements stock and records it once", async () => {
  const product = await insertProduct({ title: "Pay me", price: 20, stock: 2 });
  const buyer = { id: BUYER, name: "Buyer", email: "b@example.com" };

  const priced = await priceCart(
    BUYER,
    [{ productId: product.insertedId.toString(), quantity: 2 }],
    0.99
  );
  const [order] = await createPendingOrders(buyer, priced, { address: "1 Test St, Testville", phone: "555" });

  const intent = {
    id: "pi_test_123",
    amount: 4099,
    amount_received: 4099,
    currency: "usd",
    metadata: { buyerId: BUYER, orderIds: order._id.toString() },
  };

  const first = await applySuccessfulPayment(intent);
  assert.equal(first.updated, 1);

  const savedOrder = await getDb().collection("orders").findOne({ _id: order._id });
  assert.equal(savedOrder.paymentStatus, "paid");
  assert.equal(savedOrder.transactionId, "pi_test_123");

  const savedProduct = await getDb().collection("products").findOne({ _id: product.insertedId });
  assert.equal(savedProduct.stock, 0);
  assert.equal(savedProduct.status, "sold");

  const payments = await getDb().collection("payments").find({ transactionId: "pi_test_123" }).toArray();
  assert.equal(payments.length, 1, "one payment row per intent");
  assert.equal(payments[0].amount, 40.99);

  // replay must not decrement stock again
  const second = await applySuccessfulPayment(intent);
  assert.equal(second.updated, 0);
  const again = await getDb().collection("products").findOne({ _id: product.insertedId });
  assert.equal(again.stock, 0);
  assert.equal(
    (await getDb().collection("payments").find({ transactionId: "pi_test_123" }).toArray()).length,
    1
  );
});

test("webhook verifies the signature and is idempotent per event id", async () => {
  const product = await insertProduct({ title: "Webhook item", price: 30, stock: 1 });
  const buyer = { id: BUYER, name: "Buyer", email: "b@example.com" };

  const priced = await priceCart(BUYER, [{ productId: product.insertedId.toString(), quantity: 1 }], 0.99);
  const [order] = await createPendingOrders(buyer, priced, { address: "1 Test St, Testville", phone: "555" });

  const event = {
    id: "evt_test_1",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_webhook_1",
        amount: 3099,
        amount_received: 3099,
        currency: "usd",
        metadata: { buyerId: BUYER, orderIds: order._id.toString() },
      },
    },
  };

  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/payments/webhook`;
  const payload = JSON.stringify(event);
  const sign = (body, secret = "whsec_test_secret") =>
    Stripe.webhooks.generateTestHeaderString({ payload: body, secret });

  try {
    const bad = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      body: payload,
    });
    assert.equal(bad.status, 400, "a wrong signature is rejected");
    assert.match((await bad.json()).message, /signature verification failed/i);

    const okRes = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sign(payload) },
      body: payload,
    });
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.equal(body.received, true);
    assert.equal(body.updated, 1);

    const paid = await getDb().collection("orders").findOne({ _id: order._id });
    assert.equal(paid.paymentStatus, "paid");
    assert.equal((await getDb().collection("products").findOne({ _id: product.insertedId })).stock, 0);

    // Stripe retries: same event id must be a no-op
    const replay = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sign(payload) },
      body: payload,
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).duplicate, true);
    assert.equal((await getDb().collection("products").findOne({ _id: product.insertedId })).stock, 0);
  } finally {
    server.close();
  }
});

test("failed payment cancels the order without touching stock", async () => {
  const product = await insertProduct({ title: "Fails", price: 15, stock: 3 });
  const buyer = { id: BUYER, name: "Buyer", email: "b@example.com" };
  const priced = await priceCart(BUYER, [{ productId: product.insertedId.toString(), quantity: 1 }], 0.99);
  const [order] = await createPendingOrders(buyer, priced, { address: "1 Test St, Testville", phone: "555" });
  await getDb().collection("orders").updateOne({ _id: order._id }, { $set: { transactionId: "pi_fail_1" } });

  await handleWebhookEvent({
    id: "evt_fail_1",
    type: "payment_intent.payment_failed",
    data: { object: { id: "pi_fail_1", last_payment_error: { message: "card declined" } } },
  });

  const saved = await getDb().collection("orders").findOne({ _id: order._id });
  assert.equal(saved.paymentStatus, "failed");
  assert.equal(saved.orderStatus, "cancelled");
  assert.equal((await getDb().collection("products").findOne({ _id: product.insertedId })).stock, 3);
});

test.after(async () => {
  await closeDB();
  await mongo.stop();
});

