// ADDON: saas-mt — Pak Kasir webhook receiver
// Called by Pak Kasir when payment status changes (completed).
import { NextResponse } from "next/server";
import { getOrderById, updateOrderStatus } from "@/lib/db";
import { activatePlan } from "@/lib/customer/activatePlan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { order_id, amount, status, completed_at, project } = body;

  if (project !== "cortex-ai") {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }
  if (!order_id || !status) {
    return NextResponse.json({ error: "Missing order_id or status" }, { status: 400 });
  }

  const order = await getOrderById(order_id);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (amount && Number(amount) !== order.amount) {
    console.warn(`[pakasir-webhook] Amount mismatch for ${order_id}: expected ${order.amount}, got ${amount}`);
    return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
  }

  if (order.status === "completed") {
    return NextResponse.json({ ok: true, message: "Already completed" });
  }

  if (status === "completed") {
    await updateOrderStatus(order_id, "completed", completed_at || new Date().toISOString());
    await activatePlan({
      customerId: order.customerId,
      plan: order.plan,
      durationDays: order.durationDays,
      quotaDailyLimit: order.quotaDailyLimit,
      quotaMonthlyLimit: order.quotaMonthlyLimit,
      paymentInfo: { orderId: order.orderId, amount: order.amount, method: order.paymentMethod },
    });
  } else if (status === "canceled") {
    await updateOrderStatus(order_id, "canceled");
  }

  return NextResponse.json({ ok: true });
}
