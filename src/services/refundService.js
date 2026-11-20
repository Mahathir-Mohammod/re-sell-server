import { getDb } from "../config/db.js";
import { collections } from "../models/indexes.js";
import { getStripe } from "../config/stripe.js";
import { ApiError } from "../utils/ApiError.js";

const payments = () => getDb().collection(collections.payments);

// Refunds one order's share of a payment intent. Several orders can share one intent
// (a cart spanning sellers), so the refund amount is the order total, not the whole charge.
export async function refundOrder(order, stripe = getStripe()) {
  if (!order.transactionId) return null;

  const amount = Math.round(Number(order.total) * 100);

  let refund;
  try {
    refund = await stripe.refunds.create(
      { payment_intent: order.transactionId, amount },
      // idempotency: a double-click cannot refund twice
      { idempotencyKey: `refund_order_${order._id}` }
    );
  } catch (err) {
    console.error("stripe refund failed:", err?.message);
    throw new ApiError(502, "Could not refund this order, please try again in a moment");
  }

  const payment = await payments().findOne({ transactionId: order.transactionId });
  if (payment) {
    const refundedAmount = Number((((payment.refundedAmount ?? 0) + amount) / 100).toFixed(2));
    await payments().updateOne(
      { _id: payment._id },
      {
        $set: {
          refundedAmount,
          refundIds: [...(payment.refundIds ?? []), refund.id],
          status: refundedAmount >= payment.amount ? "refunded" : "paid",
          updatedAt: new Date(),
        },
      }
    );
  }

  return { refundId: refund.id, amount: amount / 100, status: refund.status };
}