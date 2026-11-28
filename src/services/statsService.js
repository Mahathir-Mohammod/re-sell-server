import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";

const db = () => getDb();
const users = () => db().collection(collections.user);
const products = () => db().collection(collections.products);
const orders = () => db().collection(collections.orders);
const reviews = () => db().collection(collections.reviews);

const SELLER_FIELDS = {
  name: 1,
  email: 1,
  image: 1,
  phone: 1,
  location: 1,
  bio: 1,
  isVerifiedSeller: 1,
  createdAt: 1,
};

// Home page counters. Everything is a live count so the numbers never go stale
// the way seeded copy would.
export async function getMarketplaceStats() {
  const [productCount, sellerCount, buyerCount, completedOrders, categoryCount, reviewAgg, ratingAgg] =
    await Promise.all([
      products().countDocuments({ status: "available", moderationStatus: "approved" }),
      users().countDocuments({ role: "seller", status: { $ne: "blocked" } }),
      users().countDocuments({ role: "buyer", status: { $ne: "blocked" } }),
      orders().countDocuments({ orderStatus: "delivered" }),
      db().collection(collections.categories).countDocuments(),
      reviews().countDocuments(),
      products()
        .aggregate([
          { $match: { ratingCount: { $gt: 0 } } },
          { $group: { _id: null, avg: { $avg: "$ratingAvg" } } },
        ])
        .next(),
    ]);

  return {
    products: productCount,
    sellers: sellerCount,
    buyers: buyerCount,
    completedOrders,
    categories: categoryCount,
    reviews: reviewAgg,
    averageRating: Number((ratingAgg?.avg ?? 0).toFixed(1)),
  };
}

// Rating per seller, from the reviews users actually left.
async function sellerRatings() {
  const rows = await reviews()
    .aggregate([
      { $match: { sellerId: { $type: "string" } } },
      { $group: { _id: "$sellerId", ratingAvg: { $avg: "$rating" }, ratingCount: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((row) => [row._id, { ratingAvg: row.ratingAvg, ratingCount: row.ratingCount }]));
}

const shapeSeller = (user, rating) => ({
  _id: user._id.toString(),
  name: user.name,
  image: user.image ?? null,
  location: user.location ?? "",
  bio: user.bio ?? "",
  isVerified: user.isVerifiedSeller === true,
  joinedAt: user.createdAt,
  ratingAvg: Number((rating?.ratingAvg ?? 0).toFixed(1)),
  ratingCount: rating?.ratingCount ?? 0,
});

export async function listTopSellers(limit = 6) {
  const ratings = await sellerRatings();

  const sellers = await users()
    .find(
      { role: "seller", status: { $ne: "blocked" }, isVerifiedSeller: true },
      { projection: SELLER_FIELDS }
    )
    .limit(50)
    .toArray();

  // verified sellers first; when there are none yet, fall back to anyone with reviews
  const pool = sellers.length
    ? sellers
    : await users().find({ role: "seller", status: { $ne: "blocked" } }, { projection: SELLER_FIELDS }).limit(50).toArray();

  return pool
    .map((user) => shapeSeller(user, ratings.get(user._id.toString())))
    .sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount)
    .slice(0, limit);
}

export async function getPublicSeller(id) {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "Seller not found");

  const user = await users().findOne(
    { _id: new ObjectId(id), status: { $ne: "blocked" } },
    { projection: { ...SELLER_FIELDS, role: 1 } }
  );
  if (!user) throw new ApiError(404, "Seller not found");

  const [listings, ratings, soldCount] = await Promise.all([
    products()
      .find({ "sellerInfo.userId": id, status: "available", moderationStatus: "approved" })
      .sort({ createdAt: -1 })
      .limit(24)
      .toArray(),
    sellerRatings(),
    orders().countDocuments({ "sellerInfo.userId": id, orderStatus: "delivered" }),
  ]);

  return {
    seller: { ...shapeSeller(user, ratings.get(id)), role: user.role },
    listings,
    stats: {
      listings: listings.length,
      completedOrders: soldCount,
      ratingAvg: Number((ratings.get(id)?.ratingAvg ?? 0).toFixed(1)),
      ratingCount: ratings.get(id)?.ratingCount ?? 0,
    },
  };
}