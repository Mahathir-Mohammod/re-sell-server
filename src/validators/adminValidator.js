import { z } from "zod";
import { objectId, pageQuery } from "../middleware/validate.js";
import { MODERATION } from "./productValidator.js";

const ROLES = ["buyer", "seller", "admin"];
const USER_STATUS = ["active", "blocked"];
const ORDER_STATUS = ["pending", "accepted", "processing", "shipped", "delivered", "cancelled", "rejected"];
const PAYMENT_STATUS = ["pending", "paid", "failed", "refunded"];

const search = z.string().trim().min(1).max(80).optional();

export const adminProductsSchema = {
  query: z.object({
    ...pageQuery,
    moderationStatus: z.enum(MODERATION).optional(),
    status: z.enum(["available", "unavailable", "sold", "pending", "rejected"]).optional(),
    sellerId: z.string().trim().max(64).optional(),
    search,
  }),
};

export const moderateProductSchema = {
  body: z.object({
    moderationStatus: z.enum(MODERATION),
    reason: z.string().trim().max(300).optional(),
  }),
};

export const adminUsersSchema = {
  query: z.object({
    ...pageQuery,
    role: z.enum(ROLES).optional(),
    status: z.enum(USER_STATUS).optional(),
    search,
  }),
};

export const adminUserIdSchema = {
  params: z.object({ id: objectId }),
};

export const adminUserPatchSchema = {
  body: z
    .object({ role: z.enum(ROLES).optional(), status: z.enum(USER_STATUS).optional() })
    .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" }),
};

export const adminOrdersSchema = {
  query: z.object({
    ...pageQuery,
    status: z.enum(ORDER_STATUS).optional(),
    paymentStatus: z.enum(PAYMENT_STATUS).optional(),
    search,
  }),
};

// Admins can also cancel, which sellers cannot.
export const adminStatusSchema = {
  body: z.object({ status: z.enum(ORDER_STATUS) }),
};

export const adminPaymentsSchema = {
  query: z.object({
    ...pageQuery,
    status: z.enum(PAYMENT_STATUS).optional(),
    search,
  }),
};

export const sellerOrdersSchema = {
  query: z.object({
    ...pageQuery,
    status: z.enum(ORDER_STATUS).optional(),
    paymentStatus: z.enum(PAYMENT_STATUS).optional(),
    search,
  }),
};