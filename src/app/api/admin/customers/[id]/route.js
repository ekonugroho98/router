// ADDON: saas-mt — Admin API: single-customer CRUD (get, patch, delete)
import { NextResponse } from "next/server";
import {
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  listCustomerApiKeys,
  getCustomerUsageToday,
  getCustomerUsageThisMonth,
  getCustomerUsageDaily,
  getCustomerUsageRecent,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const [apiKeys, today, month, daily, recent] = await Promise.all([
    listCustomerApiKeys(id),
    getCustomerUsageToday(id),
    getCustomerUsageThisMonth(id),
    getCustomerUsageDaily(id, 30),
    getCustomerUsageRecent(id, { limit: 50 }),
  ]);

  // Mask keys (admin doesn't need raw keys for security)
  const maskedKeys = apiKeys.map((k) => ({
    id: k.id,
    name: k.name,
    keyMasked: maskKey(k.key),
    isActive: k.isActive,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }));

  return NextResponse.json({
    customer,
    apiKeys: maskedKeys,
    usage: { today, month, daily, recent },
  });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Admin can change: displayName, plan, quotas, isActive (suspend), suspendedReason
  const patch = {};
  if ("displayName" in body) patch.displayName = body.displayName;
  if ("plan" in body) patch.plan = body.plan;
  if ("quotaDailyLimit" in body) patch.quotaDailyLimit = Number(body.quotaDailyLimit);
  if ("quotaMonthlyLimit" in body) patch.quotaMonthlyLimit = Number(body.quotaMonthlyLimit);
  if ("isActive" in body) patch.isActive = Boolean(body.isActive);
  if ("suspendedReason" in body) patch.suspendedReason = body.suspendedReason;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await updateCustomer(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, customer: updated });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  await deleteCustomer(id);
  return NextResponse.json({ success: true });
}

function maskKey(key) {
  if (!key || key.length < 16) return "***";
  return `${key.slice(0, 12)}...${key.slice(-4)}`;
}
