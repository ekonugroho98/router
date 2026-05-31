// ADDON: saas-mt — Check payment status for an order (polling endpoint)
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getOrderById, updateOrderStatus, updateOrderPayment } from "@/lib/db";
import { getPaymentStatus } from "@/lib/pakasir";
import { activatePlan } from "@/lib/customer/activatePlan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { orderId } = await params;
  const order = await getOrderById(orderId);
  if (!order) return NextResponse.json({ error: "Order tidak ditemukan" }, { status: 404 });
  if (order.customerId !== customer.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // If already completed/canceled, just return DB status
  if (order.status !== "pending") {
    return NextResponse.json({ order });
  }

  // Poll Pak Kasir for latest status
  try {
    const payment = await getPaymentStatus({
      orderId: order.orderId,
      amount: order.amount,
    });

    if (payment.status === "completed" && order.status !== "completed") {
      await updateOrderStatus(order.orderId, "completed", payment.completed_at);
      const result = await activatePlan({
        customerId: order.customerId,
        plan: order.plan,
        durationDays: order.durationDays,
        quotaDailyLimit: order.quotaDailyLimit,
        quotaMonthlyLimit: order.quotaMonthlyLimit,
        paymentInfo: { orderId: order.orderId, amount: order.amount, method: order.paymentMethod },
      });
      return NextResponse.json({
        order: { ...order, status: "completed", completedAt: payment.completed_at },
        activated: true,
        isFirstActivation: result.isFirstActivation,
        apiKey: result.apiKey ? { id: result.apiKey.id, key: result.apiKey.key } : undefined,
      });
    }

    if (payment.status === "canceled") {
      await updateOrderStatus(order.orderId, "canceled");
      return NextResponse.json({ order: { ...order, status: "canceled" } });
    }

    // Still pending — update payment details if missing
    if (!order.paymentNumber && payment.payment_number) {
      await updateOrderPayment(order.orderId, {
        paymentNumber: payment.payment_number,
        paymentUrl: payment.payment_url,
        expiredAt: payment.expired_at,
        fee: payment.fee || 0,
        totalPayment: payment.total_payment || order.amount,
      });
    }

    return NextResponse.json({ order: { ...order, ...payment } });
  } catch (err) {
    return NextResponse.json({ order, pollError: err.message });
  }
}
