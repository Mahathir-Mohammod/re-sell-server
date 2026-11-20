import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";

const users = () => getDb().collection(collections.user);
const products = () => getDb().collection(collections.products);
const orders = () => getDb().collection(collections.orders);

const MONTH_FORMAT = "%Y-%m";
const MONTHS = 6;
const PAID = { $eq: ["$paymentStatus", "paid"] };

// Every chart gets the same filled bucket list, so a quiet month renders as zero
// instead of a gap. Oldest first, which is the direction recharts expects.
function recentMonths(count = MONTHS, from = new Date()) {
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

const startOfBucket = (months) => new Date(`${months[0]}-01T00:00:00.000Z`);

function fillSeries(months, rows, fields) {
  const byMonth = new Map(rows.map((row) => [row._id, row]));
  return months.map((month) => {
    const row = byMonth.get(month) ?? {};
    return { month, ...Object.fromEntries(fields.map((f) => [f, row[f] ?? 0])) };
  });
}

const round2 = (n) => Number((n ?? 0).toFixed(2));

export async function sellerAnalytics(sellerId) {
  const months = recentMonths();
  const since = startOfBucket(months);
  const mine = { "sellerInfo.userId": sellerId };

  const [monthlyRows, topProducts, statusRows] = await Promise.all([
    orders()
      .aggregate([
        { $match: { ...mine, paymentStatus: "paid", createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: MONTH_FORMAT, date: "$createdAt" } },
            revenue: { $sum: "$total" },
            orders: { $sum: 1 },
            units: {
              $sum: { $map: { input: { $ifNull: ["$items", []] }, as: "i", in: "$$i.quantity" } },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    orders()
      .aggregate([
        { $match: { ...mine, paymentStatus: "paid" } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            title: { $last: "$items.title" },
            units: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { units: -1 } },
        { $limit: 5 },
      ])
      .toArray(),
    orders()
      .aggregate([{ $match: mine }, { $group: { _id: "$orderStatus", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      .toArray(),
  ]);

  return {
    monthly: fillSeries(months, monthlyRows, ["revenue", "orders", "units"]).map((row) => ({
      ...row,
      revenue: round2(row.revenue),
    })),
    topProducts: topProducts.map((p) => ({
      productId: p._id,
      title: p.title,
      units: p.units,
      revenue: round2(p.revenue),
    })),
    byStatus: statusRows.map((r) => ({ status: r._id ?? "pending", count: r.count })),
  };
}

export async function adminAnalytics() {
  const months = recentMonths();
  const since = startOfBucket(months);

  const [orderRows, userRows, categoryRows, statusRows] = await Promise.all([
    orders()
      .aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: MONTH_FORMAT, date: "$createdAt" } },
            orders: { $sum: 1 },
            // revenue only counts money that actually arrived
            revenue: { $sum: { $cond: [PAID, "$total", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    users()
      .aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: MONTH_FORMAT, date: "$createdAt" } },
            signups: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    products()
      .aggregate([
        { $group: { _id: "$category", count: { $sum: 1 }, views: { $sum: { $ifNull: ["$views", 0] } } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ])
      .toArray(),
    orders()
      .aggregate([{ $group: { _id: "$orderStatus", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      .toArray(),
  ]);

  return {
    monthly: fillSeries(months, orderRows, ["orders", "revenue"]).map((row) => ({
      ...row,
      revenue: round2(row.revenue),
    })),
    signups: fillSeries(months, userRows, ["signups"]),
    topCategories: categoryRows.map((c) => ({
      category: c._id ?? "uncategorised",
      count: c.count,
      views: c.views,
    })),
    byStatus: statusRows.map((r) => ({ status: r._id ?? "pending", count: r.count })),
  };
}