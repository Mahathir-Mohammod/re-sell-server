// Phase 4 checks: admin moderation, seller order transitions, analytics — real HTTP.
// Called by verify-auth.mjs while its client + API + in-memory Mongo are running.
import { MongoClient } from "mongodb";

export async function runDashboardChecks({ API_URL, CLIENT_URL, MONGODB_URI, sellerToken, sellerId, assert }) {
  const auth = (jwt) => ({ "content-type": "application/json", authorization: `Bearer ${jwt}` });
  const json = async (res) => ({ status: res.status, body: await res.json() });

  async function signUpAs(email, role = "buyer") {
    const res = await fetch(`${CLIENT_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: CLIENT_URL },
      body: JSON.stringify({ name: email, email, password: "password123", role }),
    });
    assert(res.ok, `sign-up ${email} returned ${res.status}`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const { token } = await (await fetch(`${CLIENT_URL}/api/auth/token`, { headers: { cookie } })).json();
    return token;
  }

  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db();

  // admins are seeded in the DB, never self-declared at sign-up
  const adminToken = await signUpAs("verify-admin@example.com");
  await db.collection("user").updateOne({ email: "verify-admin@example.com" }, { $set: { role: "admin", status: "active" } });

  const draft = (title) => ({
    title,
    description: "Listed by the Phase 4 verification run.",
    category: "furniture",
    condition: "Used",
    price: 40,
    stock: 2,
    location: "Test City",
    images: ["https://picsum.photos/seed/phase4/800/600"],
  });

  console.log("18. admin product queue lists pending listings");
  const pendingProduct = (
    await json(
      await fetch(`${API_URL}/api/products`, { method: "POST", headers: auth(sellerToken), body: JSON.stringify(draft("Moderation Sofa")) })
    )
  ).body.data;

  const queue = await json(await fetch(`${API_URL}/api/admin/products?moderationStatus=pending`, { headers: auth(adminToken) }));
  assert(queue.status === 200, `admin product list returned ${queue.status}`);
  assert(queue.body.data.some((p) => p._id === pendingProduct._id), "pending listing is in the queue");

  console.log("19. approving publishes it; rejecting keeps it hidden");
  const approve = await json(
    await fetch(`${API_URL}/api/admin/products/${pendingProduct._id}`, {
      method: "PATCH",
      headers: auth(adminToken),
      body: JSON.stringify({ moderationStatus: "approved" }),
    })
  );
  assert(approve.status === 200, `approve returned ${approve.status}`);
  assert(approve.body.data.moderationStatus === "approved", "moderationStatus flipped");
  const publicList = await json(await fetch(`${API_URL}/api/products?search=Moderation%20Sofa`));
  assert(publicList.body.meta.total === 1, "approved listing is now public");

  const rejectTarget = (
    await json(
      await fetch(`${API_URL}/api/products`, { method: "POST", headers: auth(sellerToken), body: JSON.stringify(draft("Rejected Lamp")) })
    )
  ).body.data;
  const reject = await json(
    await fetch(`${API_URL}/api/admin/products/${rejectTarget._id}`, {
      method: "PATCH",
      headers: auth(adminToken),
      body: JSON.stringify({ moderationStatus: "rejected", reason: "Photo does not match the item" }),
    })
  );
  assert(reject.body.data.moderationStatus === "rejected", "listing rejected with a reason");
  assert(
    (await json(await fetch(`${API_URL}/api/products?search=Rejected%20Lamp`))).body.meta.total === 0,
    "rejected listing stays out of search"
  );

  console.log("20. non-admins are locked out of /api/admin");
  const buyerToken = await signUpAs("verify-buyer2@example.com");
  const buyerToken2 = await signUpAs("verify-reporter@example.com");
  assert((await fetch(`${API_URL}/api/admin/products`, { headers: auth(buyerToken) })).status === 403, "buyer blocked from admin routes");
  assert((await fetch(`${API_URL}/api/admin/products`, { headers: auth(sellerToken) })).status === 403, "seller blocked from admin routes");

  console.log("21. seller sees the order and walks it through the flow");
  const buyer = await db.collection("user").findOne({ email: "verify-buyer2@example.com" });
  const buyerId = buyer._id.toString();
  const { insertedId: orderId } = await db.collection("orders").insertOne({
    buyerInfo: { userId: buyerId, name: "Buyer Two", email: "verify-buyer2@example.com", phone: "555", address: "1 Test St" },
    sellerInfo: { userId: sellerId, name: "Verify Seller", email: "verify@example.com" },
    items: [{ productId: pendingProduct._id, title: pendingProduct.title, price: 40, quantity: 1, image: null }],
    productId: pendingProduct._id,
    subtotal: 40,
    deliveryFee: 0.99,
    total: 40.99,
    paymentStatus: "paid",
    orderStatus: "pending",
    transactionId: "pi_phase4_verify",
    statusHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const incoming = await json(await fetch(`${API_URL}/api/seller/orders`, { headers: auth(sellerToken) }));
  assert(incoming.status === 200, `seller orders returned ${incoming.status}`);
  assert(incoming.body.data.some((o) => o._id === String(orderId)), "order visible to its seller");

  const move = async (status) =>
    json(
      await fetch(`${API_URL}/api/seller/orders/${orderId}/status`, {
        method: "PATCH",
        headers: auth(sellerToken),
        body: JSON.stringify({ status }),
      })
    );

  assert((await move("accepted")).body.data.orderStatus === "accepted", "pending -> accepted");
  const illegal = await move("delivered");
  assert(illegal.status === 400, `skipping a step rejected (${illegal.status})`);
  assert((await move("processing")).body.data.orderStatus === "processing", "accepted -> processing");
  assert((await move("shipped")).body.data.orderStatus === "shipped", "processing -> shipped");
  assert((await move("delivered")).body.data.orderStatus === "delivered", "shipped -> delivered");
  assert((await move("accepted")).status === 400, "delivered is terminal");

  console.log("22. another seller cannot move someone else's order");
  const intruderToken = await signUpAs("verify-intruder@example.com", "seller");
  const hijack = await fetch(`${API_URL}/api/seller/orders/${orderId}/status`, {
    method: "PATCH",
    headers: auth(intruderToken),
    body: JSON.stringify({ status: "accepted" }),
  });
  assert(hijack.status === 403, `foreign order update rejected (${hijack.status})`);

  console.log("23. admin stats, analytics and payments respond");
  const stats = await json(await fetch(`${API_URL}/api/admin/stats`, { headers: auth(adminToken) }));
  assert(stats.status === 200, `admin stats returned ${stats.status}`);
  assert(stats.body.data.users.total >= 5, "users counted");
  assert(typeof stats.body.data.revenue.net === "number", "revenue reported");

  const sellerAnalytics = await json(await fetch(`${API_URL}/api/seller/analytics`, { headers: auth(sellerToken) }));
  assert(sellerAnalytics.status === 200, `seller analytics returned ${sellerAnalytics.status}`);
  assert(sellerAnalytics.body.data.monthly.length === 6, "six month buckets");
  assert(Array.isArray(sellerAnalytics.body.data.topProducts), "top products present");

  const adminAnalytics = await json(await fetch(`${API_URL}/api/admin/analytics`, { headers: auth(adminToken) }));
  assert(adminAnalytics.status === 200, `admin analytics returned ${adminAnalytics.status}`);
  assert(adminAnalytics.body.data.signups.length === 6, "signup series present");

  const payments = await json(await fetch(`${API_URL}/api/admin/payments`, { headers: auth(adminToken) }));
  assert(payments.status === 200, `admin payments returned ${payments.status}`);
  assert(payments.body.meta.summary, "payments summary attached to meta");

  console.log("24. blocking a user takes effect on their next request");
  const intruder = await db.collection("user").findOne({ email: "verify-intruder@example.com" });
  const blocked = await json(
    await fetch(`${API_URL}/api/admin/users/${intruder._id}`, {
      method: "PATCH",
      headers: auth(adminToken),
      body: JSON.stringify({ status: "blocked" }),
    })
  );
  assert(blocked.body.data.status === "blocked", "status set to blocked");
  const afterBlock = await fetch(`${API_URL}/api/users/me`, { headers: auth(intruderToken) });
  assert(afterBlock.status === 403, `blocked user gets ${afterBlock.status}`);

  console.log("25. admin cannot change or delete their own account");
  const admin = await db.collection("user").findOne({ email: "verify-admin@example.com" });
  const selfEdit = await fetch(`${API_URL}/api/admin/users/${admin._id}`, {
    method: "PATCH",
    headers: auth(adminToken),
    body: JSON.stringify({ role: "buyer" }),
  });
  assert(selfEdit.status === 400, `self edit rejected (${selfEdit.status})`);
  const selfDelete = await fetch(`${API_URL}/api/admin/users/${admin._id}`, {
    method: "DELETE",
    headers: auth(adminToken),
  });
  assert(selfDelete.status === 400, `self delete rejected (${selfDelete.status})`);

  console.log("26. deleting a user removes the account and unsells their listings");
  const orphan = await db.collection("user").findOne({ email: "verify-intruder@example.com" });
  await db.collection("products").insertOne({
    ...draft("Orphaned Desk"),
    slug: "orphaned-desk",
    moderationStatus: "approved",
    status: "available",
    sellerInfo: { userId: orphan._id.toString(), name: "Verify Intruder", email: "verify-intruder@example.com" },
    isFeatured: false,
    views: 0,
    ratingAvg: 0,
    ratingCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const gone = await fetch(`${API_URL}/api/admin/users/${orphan._id}`, { method: "DELETE", headers: auth(adminToken) });
  assert(gone.status === 200, `delete returned ${gone.status}`);
  assert(await db.collection("user").findOne({ email: "verify-intruder@example.com" }).then((u) => u === null), "user row gone");
  assert(
    (await db.collection("products").findOne({ slug: "orphaned-desk" })).status === "unavailable",
    "their listings stop being buyable"
  );
  assert((await fetch(`${API_URL}/api/products?search=Orphaned%20Desk`)).status === 200, "search still healthy");

  console.log("27. wishlist saves, lists and removes over HTTP");
  const save = await json(
    await fetch(`${API_URL}/api/wishlist`, {
      method: "POST",
      headers: auth(sellerToken),
      body: JSON.stringify({ productId: pendingProduct._id }),
    })
  );
  assert(save.status === 201, `save returned ${save.status}`);

  const saved = await json(await fetch(`${API_URL}/api/wishlist`, { headers: auth(sellerToken) }));
  assert(saved.body.meta.total === 1, "wishlist has one item");
  assert(saved.body.data[0]._id === pendingProduct._id, "the saved product comes back with its data");

  await fetch(`${API_URL}/api/wishlist`, {
    method: "POST",
    headers: auth(sellerToken),
    body: JSON.stringify({ productId: pendingProduct._id }),
  });
  assert(
    (await json(await fetch(`${API_URL}/api/wishlist`, { headers: auth(sellerToken) }))).body.meta.total === 1,
    "saving twice does not duplicate"
  );

  const removed = await json(
    await fetch(`${API_URL}/api/wishlist/${pendingProduct._id}`, {
      method: "DELETE",
      headers: auth(sellerToken),
    })
  );
  assert(removed.body.data.removed === true, "remove reports the row was deleted");
  assert(
    (await json(await fetch(`${API_URL}/api/wishlist`, { headers: auth(sellerToken) }))).body.meta.total === 0,
    "wishlist is empty again"
  );
  assert(
    (await fetch(`${API_URL}/api/wishlist`, { headers: { authorization: "Bearer not-a-jwt" } })).status === 401,
    "a garbage token cannot read a wishlist"
  );

  console.log("28. seller verification badge reaches the product payload");
  const verified = await json(
    await fetch(`${API_URL}/api/admin/sellers/${sellerId}/verify`, {
      method: "PATCH",
      headers: auth(adminToken),
      body: JSON.stringify({ verified: true }),
    })
  );
  assert(verified.status === 200, `verify returned ${verified.status}`);
  assert(verified.body.data.isVerifiedSeller === true, "seller flagged as verified");

  const withBadge = await json(await fetch(`${API_URL}/api/products?search=Moderation%20Sofa`));
  assert(withBadge.body.data[0].sellerInfo.isVerified === true, "listing carries the verified badge");

  await fetch(`${API_URL}/api/admin/sellers/${sellerId}/verify`, {
    method: "PATCH",
    headers: auth(adminToken),
    body: JSON.stringify({ verified: false }),
  });
  const withoutBadge = await json(await fetch(`${API_URL}/api/products?search=Moderation%20Sofa`));
  assert(withoutBadge.body.data[0].sellerInfo.isVerified === false, "badge follows the live user row");

  console.log("29. reporting a listing, refusing duplicates, and resolving it");
  const reportBody = { productId: pendingProduct._id, reason: "misleading", details: "photos look reused" };
  const firstReport = await json(
    await fetch(`${API_URL}/api/reports`, {
      method: "POST",
      headers: auth(buyerToken2),
      body: JSON.stringify(reportBody),
    })
  );
  assert(firstReport.status === 201, `report returned ${firstReport.status}`);

  const duplicate = await json(
    await fetch(`${API_URL}/api/reports`, {
      method: "POST",
      headers: auth(buyerToken2),
      body: JSON.stringify(reportBody),
    })
  );
  assert(duplicate.status === 409, `duplicate report rejected (${duplicate.status})`);

  const ownReport = await json(
    await fetch(`${API_URL}/api/reports`, {
      method: "POST",
      headers: auth(sellerToken),
      body: JSON.stringify({ productId: pendingProduct._id, reason: "other" }),
    })
  );
  assert(ownReport.status === 400, `reporting your own listing rejected (${ownReport.status})`);

  const reportQueue = await json(await fetch(`${API_URL}/api/admin/reports?status=open`, { headers: auth(adminToken) }));
  assert(reportQueue.body.meta.total === 1, "report is in the admin queue");
  assert(reportQueue.body.data[0].product !== null, "the reported listing is attached");

  const statsWithReports = await json(await fetch(`${API_URL}/api/admin/stats`, { headers: auth(adminToken) }));
  assert(statsWithReports.body.data.reports.open === 1, "open reports counted in stats");

  const resolved = await json(
    await fetch(`${API_URL}/api/admin/reports/${reportQueue.body.data[0]._id}`, {
      method: "PATCH",
      headers: auth(adminToken),
      body: JSON.stringify({ status: "dismissed" }),
    })
  );
  assert(resolved.body.data.status === "dismissed", "report resolved");
  assert(
    (await json(await fetch(`${API_URL}/api/admin/reports?status=open`, { headers: auth(adminToken) }))).body.meta.total === 0,
    "open queue is empty again"
  );

  await mongo.close();
}