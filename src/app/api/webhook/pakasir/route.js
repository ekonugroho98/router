// ADDON: saas-mt — Pak Kasir webhook receiver
// Called by Pak Kasir when payment status changes (completed).
import { NextResponse } from "next/server";
import { getOrderById, updateOrderStatus, updateCustomer, getCustomerById } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { order_id, amount, status, completed_at, project } = body;

  // Basic validation
  if (project !== "cortex-ai") {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  if (!order_id || !status) {
    return NextResponse.json({ error: "Missing order_id or status" }, { status: 400 });
  }

  // Find order
  const order = await getOrderById(order_id);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Verify amount matches
  if (amount && Number(amount) !== order.amount) {
    console.warn(`[pakasir-webhook] Amount mismatch for ${order_id}: expected ${order.amount}, got ${amount}`);
    return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
  }

  // Already processed
  if (order.status === "completed") {
    return NextResponse.json({ ok: true, message: "Already completed" });
  }

  if (status === "completed") {
    await updateOrderStatus(order_id, "completed", completed_at || new Date().toISOString());
    await activatePlan(order);
  } else if (status === "canceled") {
    await updateOrderStatus(order_id, "canceled");
  }

  return NextResponse.json({ ok: true });
}

async function activatePlan(order) {
  const customer = await getCustomerById(order.customerId);
  if (!customer) return;

  const meta = typeof customer.metadata === "string"
    ? JSON.parse(customer.metadata || "{}")
    : (customer.metadata || {});

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
  const ADMIN_BOT_TOKEN = process.env.ADMIN_TG_BOT_TOKEN || "";
  const ADMIN_CHAT_ID = process.env.ADMIN_TG_CHAT_ID || "";
  if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
    const msg = [
      `*[Webhook] Pembayaran Berhasil!*`,
      ``,
      `Email: \`${customer.email}\``,
      `Plan: *${order.planName}* (${order.durationDays} hari)`,
      `Amount: Rp ${order.amount.toLocaleString("id-ID")}`,
      `Method: ${order.paymentMethod}`,
      `Order: \`${order.orderId}\``,
      `Expiry: ${newExpiry}`,
    ].join("\n");

    fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
}
