// Phase 2 checks: seller CRUD, ownership, moderation and role guards.
// Called by verify-auth.mjs while its client + API + in-memory Mongo are running.
import { MongoClient } from "mongodb";

export async function runSellerChecks({ API_URL, CLIENT_URL, MONGODB_URI, sellerToken, sellerId, assert }) {
  async function signUpAs(email, role) {
    const res = await fetch(`${CLIENT_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: CLIENT_URL },
      body: JSON.stringify({ name: email, email, password: "password123", role }),
    });
    assert(res.ok, `sign-up ${email} returned ${res.status}`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const { token } = await (
      await fetch(`${CLIENT_URL}/api/auth/token`, { headers: { cookie } })
    ).json();
    return token;
  }

  // a product needs an existing category
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  await mongo.db().collection("categories").insertOne({ name: "Furniture", slug: "furniture" });

  const auth = (jwt) => ({ "content-type": "application/json", authorization: `Bearer ${jwt}` });
  const draft = {
    title: "Verifier Chair",
    description: "A chair that exists only for the verification run.",
    category: "furniture",
    condition: "Used",
    price: 50,
    stock: 1,
    location: "Test City",
    images: ["https://picsum.photos/seed/verify/800/600"],
  };

  console.log("10. seller creates a listing");
  const createRes = await fetch(`${API_URL}/api/products`, {
    method: "POST",
    headers: auth(sellerToken),
    body: JSON.stringify(draft),
  });
  const createBody = await createRes.json();
  assert(createRes.status === 201, `create returned ${createRes.status} ${JSON.stringify(createBody)}`);
  const product = createBody.data;
  assert(product.slug === "verifier-chair", `slug generated (${product.slug})`);
  assert(product.moderationStatus === "pending", "new seller listing awaits review");
  assert(product.sellerInfo.userId === sellerId, "seller attached to the listing");

  console.log("11. unapproved listing stays out of the public list");
  const publicList = await (await fetch(`${API_URL}/api/products`)).json();
  assert(!publicList.data.some((p) => p._id === product._id), "pending listing hidden from buyers");

  console.log("12. seller sees it in /products/mine");
  const mine = await (await fetch(`${API_URL}/api/products/mine`, { headers: auth(sellerToken) })).json();
  assert(mine.data.some((p) => p._id === product._id), "listing listed for its owner");

  console.log("13. buyers cannot create listings");
  const buyerToken = await signUpAs("verify-buyer@example.com", "buyer");
  const buyerCreate = await fetch(`${API_URL}/api/products`, {
    method: "POST",
    headers: auth(buyerToken),
    body: JSON.stringify({ ...draft, title: "Buyer Chair" }),
  });
  assert(buyerCreate.status === 403, `buyer create rejected (${buyerCreate.status})`);

  console.log("14. another seller cannot edit or delete it");
  const otherToken = await signUpAs("verify-other@example.com", "seller");
  const foreignPatch = await fetch(`${API_URL}/api/products/${product._id}`, {
    method: "PATCH",
    headers: auth(otherToken),
    body: JSON.stringify({ price: 1 }),
  });
  assert(foreignPatch.status === 403, `foreign update rejected (${foreignPatch.status})`);
  const foreignDelete = await fetch(`${API_URL}/api/products/${product._id}`, {
    method: "DELETE",
    headers: auth(otherToken),
  });
  assert(foreignDelete.status === 403, `foreign delete rejected (${foreignDelete.status})`);

  console.log("15. owner updates and deletes their own listing");
  const patch = await fetch(`${API_URL}/api/products/${product._id}`, {
    method: "PATCH",
    headers: auth(sellerToken),
    body: JSON.stringify({ price: 45, title: "Verifier Chair Deluxe" }),
  });
  assert(patch.status === 200, `owner update accepted (${patch.status})`);
  const patched = (await patch.json()).data;
  assert(patched.price === 45, "price updated");
  assert(patched.slug === "verifier-chair-deluxe", `slug follows the new title (${patched.slug})`);

  const del = await fetch(`${API_URL}/api/products/${product._id}`, {
    method: "DELETE",
    headers: auth(sellerToken),
  });
  assert(del.status === 200, `owner delete accepted (${del.status})`);
  assert((await fetch(`${API_URL}/api/products/${product._id}`)).status === 404, "deleted listing is gone");

  console.log("16. invalid product payloads are rejected");
  const invalid = await fetch(`${API_URL}/api/products`, {
    method: "POST",
    headers: auth(sellerToken),
    body: JSON.stringify({ ...draft, price: -5, images: [] }),
  });
  assert(invalid.status === 400, `invalid payload rejected (${invalid.status})`);
  const badCategory = await fetch(`${API_URL}/api/products`, {
    method: "POST",
    headers: auth(sellerToken),
    body: JSON.stringify({ ...draft, title: "Bad Category", category: "nope" }),
  });
  assert(badCategory.status === 400, `unknown category rejected (${badCategory.status})`);

  console.log("17. buyer can upgrade to seller");
  const upgrade = await fetch(`${API_URL}/api/users/become-seller`, {
    method: "PATCH",
    headers: auth(buyerToken),
  });
  const upgradeBody = await upgrade.json();
  assert(upgrade.status === 200 && upgradeBody.data.role === "seller", "buyer upgraded to seller");

  await mongo.close();
}