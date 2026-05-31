// ADDON: saas-mt — Check payment status for an order (polling endpoint)
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getOrderById, updateOrderStatus, updateOrderPayment } from "@/lib/db";
import { getPaymentStatus } from "@/lib/pakasir";

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
      // Activate plan
      await activatePlan(order);
      return NextResponse.json({
        order: { ...order, status: "completed", completedAt: payment.completed_at },
        activated: true,
      });
    }

    if (payment.status === "canceled") {
      await updateOrderStatus(order.orderId, "canceled");
      return NextResponse.json({
        order: { ...order, status: "canceled" },
      });
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
    // Pak Kasir unreachable — return DB state
    return NextResponse.json({ order, pollError: err.message });
  }
}

async function activatePlan(order) {
  const { updateCustomer, getCustomerById } = await import("@/lib/db");
  const customer = await getCustomerById(order.customerId);
  if (!customer) return;

  const meta = typeof customer.metadata === "string"
    ? JSON.parse(customer.metadata || "{}")
    : (customer.metadata || {});

  const expiresAt = new Date(Date.now() + order.durationDays * 24 * 60 * 60 * 1000).toISOString();

  // Extend if already has active plan
  const currentExpiry = meta.expiresAt ? new Date(meta.expiresAt) : null;
  const baseDate = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
  const newExpiry = new Date(baseDate.getTime() + order.durationDays * 24 * 60 * 60 * 1000).toISOString();

  meta.expiresAt = newExpiry;
  meta.durationDays = order.durationDays;
  meta.lastPayment = {
    orderId: order.orderId,
    amount: order.amount,
    method: order.paymentMethod,
    completedAt: new Date().toISOString(),
  };

  await updateCustomer(order.customerId, {
    plan: order.plan,
    quotaDailyLimit: order.quotaDailyLimit,
    quotaMonthlyLimit: order.quotaMonthlyLimit,
    isActive: 1,
    suspendedReason: null,
    metadata: meta,
  });

  // Notify admin
  notifyAdmin(customer.email, order).catch(() => {});
}

const ADMIN_BOT_TOKEN = process.env.ADMIN_TG_BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_TG_CHAT_ID || "";

async function notifyAdmin(email, order) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;
  const msg = [
    `*Pembayaran Berhasil!*`,
    ``,
    `Email: \`${email}\``,
    `Plan: *${order.planName}* (${order.durationDays} hari)`,
    `Amount: Rp ${order.amount.toLocaleString("id-ID")}`,
    `Method: ${order.paymentMethod}`,
    `Order: \`${order.orderId}\``,
  ].join("\n");

  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
}
