// ADDON: saas-mt — Customer orders API
// GET: list orders, POST: create new order (initiate payment)
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import {
  createOrder,
  listCustomerOrders,
  getPendingOrder,
  updateOrderPayment,
} from "@/lib/db";
import { createPayment, PLANS } from "@/lib/pakasir";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — list customer orders
export async function GET(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orders = await listCustomerOrders(customer.id);
  return NextResponse.json({ orders });
}

// POST — create order + initiate payment
export async function POST(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { planId, paymentMethod } = body;
  if (!planId || !paymentMethod) {
    return NextResponse.json({ error: "planId dan paymentMethod diperlukan" }, { status: 400 });
  }

  // Validate plan
  const selectedPlan = PLANS.find((p) => p.id === planId);
  if (!selectedPlan) {
    return NextResponse.json({ error: "Plan tidak ditemukan" }, { status: 400 });
  }

  // Check for existing pending order — cancel it first or reuse
  const pending = await getPendingOrder(customer.id);
  if (pending) {
    return NextResponse.json({
      error: "Masih ada pesanan pending. Selesaikan atau tunggu expired.",
      pendingOrder: pending.orderId,
    }, { status: 409 });
  }

  // Create order in DB
  const order = await createOrder({
    customerId: customer.id,
    planId: selectedPlan.id,
    planName: selectedPlan.name,
    amount: selectedPlan.price,
    paymentMethod,
    durationDays: selectedPlan.durationDays,
    quotaDailyLimit: selectedPlan.quotaDailyLimit,
    quotaMonthlyLimit: selectedPlan.quotaMonthlyLimit,
    plan: selectedPlan.plan,
  });

  // Create payment via Pak Kasir
  try {
    const origin = request.headers.get("origin") || request.headers.get("x-forwarded-host") || "";
    const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;

    const payment = await createPayment({
      orderId: order.orderId,
      amount: selectedPlan.price,
      method: paymentMethod,
      redirectUrl: `${baseUrl}/customer/orders`,
    });

    // Save payment details
    await updateOrderPayment(order.orderId, {
      paymentNumber: payment.payment_number,
      paymentUrl: payment.payment_url,
      expiredAt: payment.expired_at,
      fee: payment.fee || 0,
      totalPayment: payment.total_payment || selectedPlan.price,
    });

    return NextResponse.json({
      order: {
        ...order,
        paymentNumber: payment.payment_number,
        paymentUrl: payment.payment_url,
        expiredAt: payment.expired_at,
        fee: payment.fee || 0,
        totalPayment: payment.total_payment || selectedPlan.price,
      },
    });
  } catch (err) {
    // Payment creation failed — mark order as canceled
    const { updateOrderStatus } = await import("@/lib/db");
    await updateOrderStatus(order.orderId, "canceled");
    return NextResponse.json({ error: `Gagal membuat pembayaran: ${err.message}` }, { status: 502 });
  }
}
