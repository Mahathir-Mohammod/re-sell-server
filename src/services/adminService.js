import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";
import { findOrder, transitionOrder } from "./orderService.js";
import { deleteProduct } from "./productService.js";

const db = () => getDb();
const users = () => db().collection(collections.user);
const products = () => db().collection(collections.products);
const orders = () => db().collection(collections.orders);
const payments = () => db().collection(collections.payments);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Never select the whole user doc: Better Auth may add columns we do not want to ship.
const USER_FIELDS = {
  name: 1,
  email: 1,
  role: 1,
  status: 1,
  image: 1,
  phone: 1,
  location: 1,
  createdAt: 1,
};

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// ---------------------------------------------------------------- products

export async function listAdminProducts(query) {
  const filter = {};
  if (query.moderationStatus) filter.moderationStatus = query.moderationStatus;
  if (query.status) filter.status = query.status;
  if (query.sellerId) filter["sellerInfo.userId"] = query.sellerId;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search).slice(0, 80), "i");
    filter.$or = [{ title: rx }, { "sellerInfo.email": rx }, { slug: rx }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    products().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    products().countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
}

export async function moderateProduct(id, { moderationStatus, reason }) {
  const _id = toObjectId(id);
  if (!_id) throw new ApiError(404, "Product not found");

  const update = {
    moderationStatus,
    moderationReason: reason ?? null,
    moderatedAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await products().findOneAndUpdate(
    { _id },
    { $set: update },
    { returnDocument: "after" }
  );
  if (!result) throw new ApiError(404, "Product not found");
  return result;
}

// deleteProduct already allows admins through assertOwner; reuse it instead of
// duplicating the ownership rule.
export async function deleteProductAsAdmin(id) {
  return deleteProduct(id, { role: "admin", id: null });
}

// ---------------------------------------------------------------- users

export async function listAdminUsers(query) {
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search).slice(0, 80), "i");
    filter.$or = [{ name: rx }, { email: rx }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    users().find(filter, { projection: USER_FIELDS }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    users().countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
}

// An admin locking themselves out is never the intent, so self-edits are refused.
function assertNotSelf(id, adminId) {
  if (id === adminId) {
    throw new ApiError(400, "You cannot change your own account here");
  }
}

export async function updateAdminUser(id, patch, adminId) {
  const _id = toObjectId(id);
  if (!_id) throw new ApiError(404, "User not found");
  assertNotSelf(id, adminId);

  const user = await users().findOne({ _id }, { projection: { ...USER_FIELDS, role: 1 } });
  if (!user) throw new ApiError(404, "User not found");

  // demoting the only admin would leave the platform unmanageable
  if (user.role === "admin" && patch.role && patch.role !== "admin") {
    const admins = await users().countDocuments({ role: "admin", status: { $ne: "blocked" } });
    if (admins <= 1) throw new ApiError(400, "Cannot demote the last admin");
  }

  const update = { ...patch, updatedAt: new Date() };
  const updated = await users().findOneAndUpdate(
    { _id },
    { $set: update },
    { returnDocument: "after", projection: USER_FIELDS }
  );
  return updated;
}

// Deleting a user must also drop their auth rows, otherwise Better Auth keeps a
// session that points at a user document that no longer exists.
export async function deleteAdminUser(id, adminId) {
  const _id = toObjectId(id);
  if (!_id) throw new ApiError(404, "User not found");
  assertNotSelf(id, adminId);

  const user = await users().findOne({ _id }, { projection: { _id: 1 } });
  if (!user) throw new ApiError(404, "User not found");

  await Promise.all([
    db().collection(collections.session).deleteMany({ userId: id }),
    db().collection(collections.account).deleteMany({ userId: id }),
    // keep the catalogue honest: their listings stop being buyable
    products().updateMany(
      { "sellerInfo.userId": id, status: "available" },
      { $set: { status: "unavailable", updatedAt: new Date() } }
    ),
  ]);
  await users().deleteOne({ _id });

  return { _id: id };
}

// ---------------------------------------------------------------- orders

export async function listAdminOrders(query) {
  const filter = {};
  if (query.status) filter.orderStatus = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search).slice(0, 80), "i");
    filter.$or = [
      { "buyerInfo.email": rx },
      { "buyerInfo.name": rx },
      { "sellerInfo.email": rx },
      { transactionId: rx },
      ...(ObjectId.isValid(query.search) ? [{ _id: new ObjectId(query.search) }] : []),
    ];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    orders().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    orders().countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
}

export async function updateOrderStatusAsAdmin(id, status, adminId, { stripe } = {}) {
  const order = await findOrder(id);
  return transitionOrder(order, status, adminId, { stripe });
}

// ---------------------------------------------------------------- payments

export async function listAdminPayments(query) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search).slice(0, 120), "i");
    filter.$or = [{ transactionId: rx }, { buyerId: query.search }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total, totals] = await Promise.all([
    payments().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    payments().countDocuments(filter),
    payments()
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            gross: { $sum: "$amount" },
            refunded: { $sum: { $ifNull: ["$refundedAmount", 0] } },
            count: { $sum: 1 },
          },
        },
      ])
      .next(),
  ]);

  return {
    items,
    meta: paginationMeta(page, limit, total),
    summary: {
      count: totals?.count ?? 0,
      gross: Number((totals?.gross ?? 0).toFixed(2)),
      refunded: Number((totals?.refunded ?? 0).toFixed(2)),
      net: Number(((totals?.gross ?? 0) - (totals?.refunded ?? 0)).toFixed(2)),
    },
  };
}

// ---------------------------------------------------------------- dashboard stats

export async function adminStats() {
  const [userCount, roleCounts, productCount, moderationCounts, orderCount, orderStatusCounts, revenue] =
    await Promise.all([
      users().countDocuments(),
      users().aggregate([{ $group: { _id: { $ifNull: ["$role", "buyer"] }, count: { $sum: 1 } } }]).toArray(),
      products().countDocuments(),
      products()
        .aggregate([{ $group: { _id: { $ifNull: ["$moderationStatus", "approved"] }, count: { $sum: 1 } } }])
        .toArray(),
      orders().countDocuments(),
      orders()
        .aggregate([{ $group: { _id: "$orderStatus", count: { $sum: 1 } } }])
        .toArray(),
      payments()
        .aggregate([
          { $match: { status: { $in: ["paid", "refunded"] } } },
          {
            $group: {
              _id: null,
              gross: { $sum: "$amount" },
              refunded: { $sum: { $ifNull: ["$refundedAmount", 0] } },
            },
          },
        ])
        .next(),
    ]);

  const toMap = (rows, fallback) =>
    rows.reduce((acc, row) => ({ ...acc, [row._id ?? fallback]: row.count }), {});

  return {
    // zeros are filled in so the dashboard never renders a blank card
    users: {
      total: userCount,
      byRole: { buyer: 0, seller: 0, admin: 0, ...toMap(roleCounts, "buyer") },
    },
    products: {
      total: productCount,
      byModeration: { pending: 0, approved: 0, rejected: 0, ...toMap(moderationCounts, "approved") },
    },
    orders: { total: orderCount, byStatus: toMap(orderStatusCounts, "pending") },
    revenue: {
      gross: Number((revenue?.gross ?? 0).toFixed(2)),
      refunded: Number((revenue?.refunded ?? 0).toFixed(2)),
      net: Number(((revenue?.gross ?? 0) - (revenue?.refunded ?? 0)).toFixed(2)),
    },
  };
}