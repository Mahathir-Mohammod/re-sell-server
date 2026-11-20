import { z } from "zod";
import { pageQuery } from "../middleware/validate.js";

export const cartItemsSchema = z
  .array(
    z.object({
      productId: z.string().trim().min(1).max(64),
      quantity: z.coerce.number().int().min(1).max(10),
    })
  )
  .min(1, "Your cart is empty")
  .max(20);

export const createIntentSchema = {
  body: z.object({
    items: cartItemsSchema,
    address: z.string().trim().min(10, "Full delivery address is required").max(300),
    phone: z.string().trim().min(6, "Phone number is required").max(30),
  }),
};

export const confirmPaymentSchema = {
  body: z.object({ paymentIntentId: z.string().trim().min(5).max(120) }),
};

export const orderIdSchema = {
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid order id") }),
};

export const myOrdersSchema = {
  query: z.object({
    ...pageQuery,
    status: z
      .enum(["pending", "accepted", "processing", "shipped", "delivered", "cancelled", "rejected"])
      .optional(),
  }),
};

export const updateStatusSchema = {
  body: z.object({
    status: z.enum(["accepted", "processing", "shipped", "delivered", "rejected"]),
  }),
};