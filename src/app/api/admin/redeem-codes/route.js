// ADDON: saas-mt — Admin API: manage redemption codes
import { NextResponse } from "next/server";
import { createRedeemCodes, listRedeemCodes, deactivateRedeemCode } from "@/lib/db";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireAdmin(request) {
  const token = request.cookies.get("auth_token")?.value;
  if (!token || !(await verifyDashboardAuthToken(token))) {
    return NextResponse.json({ error: "Admin auth required" }, { status: 401 });
  }
  return null;
}

// GET — list all codes
export async function GET(request) {
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;

  const codes = await listRedeemCodes();
  return NextResponse.json({ codes });
}

// POST — generate new codes
export async function POST(request) {
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const count = Math.min(50, Math.max(1, Number(body?.count) || 1));
  const plan = body?.plan || "free";
  const durationDays = Number(body?.durationDays) || 3;
  const quotaDailyLimit = Number(body?.quotaDailyLimit ?? 100);
  const quotaMonthlyLimit = Number(body?.quotaMonthlyLimit ?? 3000);
  const maxUses = Number(body?.maxUses) || 1;
  const label = body?.label || null;
  const expiresAt = body?.expiresAt || null;

  const codes = await createRedeemCodes({
    count, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxUses, label, expiresAt,
  });

  return NextResponse.json({ success: true, codes });
}

// DELETE — deactivate a code
export async function DELETE(request) {
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await deactivateRedeemCode(id);
  return NextResponse.json({ success: true });
}
