// Seeds categories, demo sellers (via Better Auth sign-up), an admin, and demo products.
// Requires: re-sell-client dev server running (Better Auth owns password hashing).
// Idempotent: re-running updates categories/products and skips existing users.
import "dotenv/config";
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const AUTH_URL = process.env.BETTER_AUTH_URL || process.env.CLIENT_URL || "http://localhost:3000";

if (!MONGODB_URI) {
  console.error("MONGODB_URI missing in .env");
  process.exit(1);
}

const SEED_PASSWORD = process.env.SEED_PASSWORD || "password123";

const categories = [
  { name: "Electronics", slug: "electronics", icon: "Laptop", image: "electronics" },
  { name: "Furniture", slug: "furniture", icon: "Sofa", image: "furniture" },
  { name: "Vehicles", slug: "vehicles", icon: "Car", image: "vehicles" },
  { name: "Fashion", slug: "fashion", icon: "Shirt", image: "fashion" },
  { name: "Mobile Phones", slug: "mobile-phones", icon: "Smartphone", image: "phones" },
  { name: "Home & Living", slug: "home-living", icon: "House", image: "home" },
  { name: "Sports", slug: "sports", icon: "Dumbbell", image: "sports" },
  { name: "Books", slug: "books", icon: "BookOpen", image: "books" },
];

const sellers = [
  { name: "Ayesha Rahman", email: "ayesha@seller.test", phone: "+1 555 0101", location: "Brooklyn, NY" },
  { name: "Marcus Lee", email: "marcus@seller.test", phone: "+1 555 0102", location: "Austin, TX" },
];

const ADMIN = { name: "ReSell Admin", email: "admin@resell.test" };

const img = (seed) => `https://picsum.photos/seed/${seed}/800/600`;

// [title, category, condition, price, stock, featured, views, rating, ratings]
const products = [
  ["MacBook Air M2 13\"", "electronics", "Like New", 899, 1, true, 420, 4.8, 12],
  ["Sony WH-1000XM5 Headphones", "electronics", "Used", 229, 2, false, 310, 4.6, 9],
  ["Dell 27\" 4K Monitor", "electronics", "Refurbished", 249, 3, true, 180, 4.3, 5],
  ["Mid-century Walnut Sofa", "furniture", "Used", 540, 1, true, 260, 4.7, 8],
  ["Solid Oak Dining Table", "furniture", "Used", 380, 1, false, 145, 4.4, 6],
  ["Ergonomic Mesh Office Chair", "furniture", "Like New", 165, 4, false, 210, 4.5, 11],
  ["Trek FX 2 Hybrid Bike", "vehicles", "Used", 420, 1, false, 190, 4.2, 4],
  ["Vespa Primavera 150", "vehicles", "Used", 2450, 1, true, 500, 4.9, 7],
  ["Thule Roof Cargo Box", "vehicles", "Like New", 310, 2, false, 95, 4.1, 3],
  ["Levi's 501 Original Jeans", "fashion", "Like New", 45, 6, false, 130, 4.3, 15],
  ["Vintage Leather Biker Jacket", "fashion", "Used", 180, 1, true, 240, 4.8, 10],
  ["Adidas Ultraboost 22", "fashion", "Used", 70, 3, false, 160, 4.0, 8],
  ["iPhone 14 Pro 256GB", "mobile-phones", "Like New", 720, 1, true, 610, 4.9, 21],
  ["Samsung Galaxy S23", "mobile-phones", "Used", 480, 2, false, 380, 4.5, 14],
  ["Pixel 7a 128GB", "mobile-phones", "Refurbished", 260, 3, false, 270, 4.2, 9],
  ["Ceramic Table Lamp Pair", "home-living", "Like New", 65, 2, false, 88, 4.4, 5],
  ["Cast Iron Dutch Oven 6Qt", "home-living", "Used", 55, 2, false, 110, 4.6, 7],
  ["Linen Duvet Cover Queen", "home-living", "Like New", 75, 3, false, 70, 4.1, 4],
  ["Wilson Pro Staff Tennis Racket", "sports", "Used", 95, 2, false, 120, 4.5, 6],
  ["Adjustable Dumbbell Set 2x24kg", "sports", "Like New", 280, 1, true, 205, 4.8, 9],
  ["Yoga Mat 6mm Non-slip", "sports", "Like New", 25, 8, false, 60, 4.2, 12],
  ["Atomic Habits — James Clear", "books", "Like New", 12, 5, false, 140, 4.9, 18],
  ["The Pragmatic Programmer", "books", "Used", 28, 2, false, 105, 4.7, 9],
  ["Sapiens — Yuval Noah Harari", "books", "Used", 10, 3, false, 95, 4.5, 11],
];

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function ensureUser({ name, email, phone, location }, role) {
  const res = await fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: AUTH_URL },
    body: JSON.stringify({
      name,
      email,
      password: SEED_PASSWORD,
      role,
      ...(phone && { phone }),
      ...(location && { location }),
    }),
  });

  if (res.ok) return "created";
  // existing user: 422/400 with USER_ALREADY_EXISTS — fine, we just need the id
  return "exists";
}

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();

try {
  console.log("seeding categories…");
  for (const category of categories) {
    await db.collection("categories").updateOne(
      { slug: category.slug },
      {
        $set: {
          ...category,
          image: img(category.image),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date(), productCount: 0 },
      },
      { upsert: true }
    );
  }

  console.log("seeding users…");
  for (const seller of sellers) {
    console.log(`  ${seller.email}: ${await ensureUser(seller, "seller")}`);
  }
  console.log(`  ${ADMIN.email}: ${await ensureUser(ADMIN, "buyer")}`);
  // role must be flipped in the DB: signup intentionally can't choose admin
  await db.collection("user").updateOne({ email: ADMIN.email }, { $set: { role: "admin", status: "active" } });

  const sellerDocs = await db
    .collection("user")
    .find({ email: { $in: sellers.map((s) => s.email) } })
    .toArray();

  if (sellerDocs.length < sellers.length) {
    throw new Error("sellers were not created — is the Better Auth client running on " + AUTH_URL + "?");
  }

  console.log("seeding products…");
  const sellerInfoFor = (i) => {
    const u = sellerDocs[i % sellerDocs.length];
    const meta = sellers.find((s) => s.email === u.email) ?? {};
    return {
      userId: u._id.toString(),
      name: u.name,
      email: u.email,
      phone: meta.phone ?? "",
    };
  };

  for (const [i, p] of products.entries()) {
    const [title, category, condition, price, stock, isFeatured, views, ratingAvg, ratingCount] = p;
    const slug = slugify(title);
    const seller = sellerDocs[i % sellerDocs.length];
    await db.collection("products").updateOne(
      { slug },
      {
        $set: {
          title,
          slug,
          category,
          condition,
          price,
          stock,
          images: [img(slug), img(`${slug}-2`)],
          description: `${title} in ${condition.toLowerCase()} condition. Well looked after, collection or delivery available.`,
          sellerInfo: sellerInfoFor(i),
          location: seller.location ?? "New York, NY",
          status: "available",
          moderationStatus: "approved",
          isFeatured,
          views,
          ratingAvg,
          ratingCount,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date(Date.now() - i * 36e5) },
      },
      { upsert: true }
    );
  }

  const [productCount, userCount] = await Promise.all([
    db.collection("products").countDocuments(),
    db.collection("user").countDocuments(),
  ]);

  console.log(`done: ${productCount} products, ${userCount} users, ${categories.length} categories`);
  console.log(`login: ${ADMIN.email} / ${SEED_PASSWORD} (admin), ${sellers[0].email} / ${SEED_PASSWORD} (seller)`);
} finally {
  await client.close();
}