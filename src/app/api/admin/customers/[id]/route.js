// ADDON: saas-mt — Admin API: single-customer CRUD (get, patch, delete)
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  deleteAllCustomerSessions,
  listCustomerApiKeys,
  getCustomerUsageToday,
  getCustomerUsageThisMonth,
  getCustomerUsageDaily,
  getCustomerUsageRecent,
  logAdminAction,
} from "@/lib/db";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Explicit admin auth check — defense in depth (dashboardGuard may be bypassed)
async function requireAdmin(request) {
  const token = request.cookies.get("auth_token")?.value;
  if (!token || !(await verifyDashboardAuthToken(token))) {
    return NextResponse.json({ error: "Admin auth required" }, { status: 401 });
  }
  return null;
}

export async function GET(request, { params }) {
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;

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
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;

  const { id } = await params;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Admin can change: displayName, plan, quotas, isActive (suspend), suspendedReason, password
  const patch = {};
  if ("displayName" in body) patch.displayName = body.displayName;
  if ("plan" in body) patch.plan = body.plan;
  if ("quotaDailyLimit" in body) {
    const v = Number(body.quotaDailyLimit);
    if (v < 0) return NextResponse.json({ error: "quotaDailyLimit must be >= 0" }, { status: 400 });
    patch.quotaDailyLimit = v;
  }
  if ("quotaMonthlyLimit" in body) {
    const v = Number(body.quotaMonthlyLimit);
    if (v < 0) return NextResponse.json({ error: "quotaMonthlyLimit must be >= 0" }, { status: 400 });
    patch.quotaMonthlyLimit = v;
  }
  if ("isActive" in body) {
    patch.isActive = Boolean(body.isActive);
    // #6: Invalidate all sessions when suspending customer
    if (!patch.isActive) {
      await deleteAllCustomerSessions(id);
    }
  }
  if ("suspendedReason" in body) patch.suspendedReason = body.suspendedReason;
  // #3: Admin password reset
  if ("newPassword" in body) {
    const pw = String(body.newPassword || "");
    if (pw.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    patch.passwordHash = await bcrypt.hash(pw, 10);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const before = await getCustomerById(id);
  if (!before) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const updated = await updateCustomer(id, patch);

  // Determine audit action
  let action = "update";
  if ("newPassword" in body) action = "reset_password";
  else if ("isActive" in body && !body.isActive) action = "suspend";
  else if ("isActive" in body && body.isActive) action = "unsuspend";

  logAdminAction({
    action,
    customerId: id,
    customerEmail: before.email,
    changes: Object.fromEntries(
      Object.keys(patch)
        .filter((k) => k !== "passwordHash")
        .map((k) => [k, { from: before[k], to: patch[k] }])
    ),
    adminIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  }).catch(() => {});

  return NextResponse.json({ success: true, customer: updated });
}

export async function DELETE(request, { params }) {
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;

  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  // Destroy Incus container if exists
  let containerDestroyed = false;
  try {
    const meta = typeof customer.metadata === "string" ? JSON.parse(customer.metadata || "{}") : (customer.metadata || {});
    const containerName = meta.container;
    if (containerName) {
      const { execSync } = await import("child_process");
      execSync(`incus delete ${containerName} --force 2>/dev/null || true`, { timeout: 30000 });
      containerDestroyed = true;
    }
  } catch (e) {
    console.warn(`[admin] Failed to destroy container for ${customer.email}:`, e?.message);
  }

  await deleteCustomer(id);

  logAdminAction({
    action: "delete",
    customerId: id,
    customerEmail: customer.email,
    changes: JSON.stringify({ containerDestroyed }),
    adminIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  }).catch(() => {});

  return NextResponse.json({ success: true, containerDestroyed });
}

function maskKey(key) {
  if (!key || key.length < 16) return "***";
  return `${key.slice(0, 12)}...${key.slice(-4)}`;
}
