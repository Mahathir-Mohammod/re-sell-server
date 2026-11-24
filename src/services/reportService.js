import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";

const reports = () => getDb().collection(collections.reports);
const products = () => getDb().collection(collections.products);

const REASONS = ["prohibited", "counterfeit", "misleading", "wrong-category", "other"];

export const REPORT_REASONS = REASONS;

// A buyer reports a listing; one open report per (product, reporter) is enough.
export async function createReport(reporter, { productId, reason, details }) {
  if (!ObjectId.isValid(productId)) throw new ApiError(400, "Invalid product id");

  const product = await products().findOne({ _id: new ObjectId(productId) }, { projection: { title: 1, sellerInfo: 1 } });
  if (!product) throw new ApiError(404, "Product not found");
  if (product.sellerInfo?.userId === reporter.id) {
    throw new ApiError(400, "You cannot report your own listing");
  }

  const existing = await reports().findOne({ productId, reporterId: reporter.id, status: "open" });
  if (existing) throw new ApiError(409, "You already reported this listing");

  const now = new Date();
  const doc = {
    productId,
    productTitle: product.title,
    sellerId: product.sellerInfo?.userId ?? null,
    reporterId: reporter.id,
    reporterEmail: reporter.email,
    reporterName: reporter.name,
    reason,
    details: details ?? "",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };

  const { insertedId } = await reports().insertOne(doc);
  return { ...doc, _id: insertedId };
}

async function assertNotMine(productId, userId) {
  const product = await products().findOne(
    { _id: new ObjectId(productId) },
    { projection: { "sellerInfo.userId": 1 } }
  );
  if (product?.sellerInfo?.userId === userId) {
    throw new ApiError(400, "You cannot report your own listing");
  }
}

export async function listReports(query) {
  const filter = {};
  if (query.status) filter.status = query.status;

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    reports().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    reports().countDocuments(filter),
  ]);

  // attach the current listing so the admin can see what is being reported
  const ids = [...new Set(items.map((r) => r.productId).filter((id) => ObjectId.isValid(id)))].map(
    (id) => new ObjectId(id)
  );
  const found = ids.length ? await products().find({ _id: { $in: ids } }).toArray() : [];
  const byId = new Map(found.map((p) => [p._id.toString(), p]));

  return {
    items: items.map((report) => ({
      ...report,
      product: byId.get(String(report.productId)) ?? null,
    })),
    meta: paginationMeta(page, limit, total),
  };
}

// "reviewed" keeps the listing, "dismissed" archives the report. Removing the listing
// is a separate, explicit call so a mis-click cannot delete a product.
export async function resolveReport(id, status, adminId) {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "Report not found");

  const result = await reports().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { status, resolvedBy: adminId, resolvedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!result) throw new ApiError(404, "Report not found");
  return result;
}

export async function openReportCount() {
  return reports().countDocuments({ status: "open" });
}

export { assertNotMine };