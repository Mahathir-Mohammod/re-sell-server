// Wishlist API: idempotent saves, per-user isolation and stale-listing cleanup.
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";
process.env.BETTER_AUTH_JWKS_URL ??= "http://localhost:3000/api/auth/jwks";

import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("wishlist_test");

const { connectDB, closeDB, getDb } = await import("../src/config/db.js");
const { default: app } = await import("../src/app.js");
const { addToWishlist, listWishlist, removeFromWishlist, wishlistCount } =
  await import("../src/services/wishlistService.js");

await connectDB();

const db = () => getDb();
const ME = new ObjectId().toString();
const OTHER_USER = new ObjectId().toString();

const insertProduct = (over = {}) =>
  db()
    .collection("products")
    .insertOne({
      title: "Saved thing",
      slug: `saved-${Math.random().toString(36).slice(2, 8)}`,
      category: "electronics",
      condition: "Used",
      price: 20,
      stock: 1,
      images: ["https://example.com/a.png"],
      description: "x",
      sellerInfo: { userId: OTHER_USER, name: "S", email: "s@example.com" },
      location: "NY",
      status: "available",
      moderationStatus: "approved",
      createdAt: new Date(),
      ...over,
    });

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  server.close();
  await closeDB();
  await mongo.stop();
});

test("saving a listing returns it with the product data", async () => {
  const { insertedId } = await insertProduct({ title: "Wishlist Lamp" });
  const saved = await addToWishlist(ME, insertedId.toString());
  assert.deepEqual(saved, { productId: insertedId.toString(), saved: true });

  const { items, meta } = await listWishlist(ME, {});
  assert.equal(meta.total, 1);
  assert.equal(items[0].title, "Wishlist Lamp");
  assert.equal(items[0]._id.toString(), insertedId.toString());
  assert.ok(items[0].wishedAt instanceof Date);
  assert.equal(await wishlistCount(ME), 1);
});

test("saving twice does not duplicate the row", async () => {
  const { items } = await listWishlist(ME, {});
  const productId = items[0]._id.toString();

  await addToWishlist(ME, productId);
  await addToWishlist(ME, productId);

  const after = await listWishlist(ME, {});
  assert.equal(after.meta.total, 1);
  assert.equal(await db().collection("wishlist").countDocuments({ productId }), 1);
});

test("wishlists are per user", async () => {
  const mine = await listWishlist(ME, {});
  const theirs = await listWishlist(OTHER_USER, {});
  assert.equal(mine.meta.total, 1);
  assert.equal(theirs.meta.total, 0);

  await addToWishlist(OTHER_USER, mine.items[0]._id.toString());
  assert.equal((await listWishlist(OTHER_USER, {})).meta.total, 1);
  assert.equal((await listWishlist(ME, {})).meta.total, 1, "other user's save is not mine");
});

test("removing is idempotent", async () => {
  const { items } = await listWishlist(ME, {});
  const productId = items[0]._id.toString();

  assert.deepEqual(await removeFromWishlist(ME, productId), { productId, removed: true });
  assert.deepEqual(await removeFromWishlist(ME, productId), { productId, removed: false });
  assert.equal((await listWishlist(ME, {})).meta.total, 0);
});

test("unknown and malformed product ids are refused", async () => {
  await assert.rejects(() => addToWishlist(ME, new ObjectId().toString()), /Product not found/);
  await assert.rejects(() => addToWishlist(ME, "not-an-id"), /Invalid product id/);
  await assert.rejects(() => removeFromWishlist(ME, "nope"), /Invalid product id/);
});

test("a listing deleted after saving drops out of the wishlist", async () => {
  const { insertedId } = await insertProduct({ title: "Doomed Chair" });
  await addToWishlist(ME, insertedId.toString());
  assert.equal((await listWishlist(ME, {})).meta.total, 1);

  await db().collection("products").deleteOne({ _id: insertedId });

  const { items, meta } = await listWishlist(ME, {});
  assert.equal(items.length, 0);
  assert.equal(meta.total, 0, "the stale row is not counted");
  assert.equal(await db().collection("wishlist").countDocuments({ userId: ME }), 0, "stale row cleaned up");
});

test("pagination applies to the wishlist", async () => {
  for (const title of ["One", "Two", "Three"]) {
    const { insertedId } = await insertProduct({ title });
    await addToWishlist(ME, insertedId.toString());
  }

  const firstPage = await listWishlist(ME, { limit: 2, page: 1 });
  const secondPage = await listWishlist(ME, { limit: 2, page: 2 });
  assert.equal(firstPage.items.length, 2);
  assert.equal(secondPage.items.length, 1);
  assert.equal(firstPage.meta.total, 3);
  assert.equal(firstPage.meta.totalPages, 2);
});

test("the wishlist needs a token", async () => {
  for (const [method, path] of [
    ["GET", "/api/wishlist"],
    ["POST", "/api/wishlist"],
    ["DELETE", `/api/wishlist/${new ObjectId().toString()}`],
  ]) {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "POST" && { body: JSON.stringify({ productId: new ObjectId().toString() }) }),
    });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal((await res.json()).success, false);
  }
});