// ADDON: saas-mt — Admin API: manage claim tokens
import { NextResponse } from "next/server";
import { createClaimTokens, listClaimTokens, deactivateClaimToken, deleteClaimToken } from "@/lib/db";
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

// GET — list all tokens
export async function GET(request) {
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;
  const tokens = await listClaimTokens();
  return NextResponse.json({ tokens });
}

// POST — generate new tokens
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
  const quotaDailyLimit = Number(body?.quotaDailyLimit ?? 300);
  const quotaMonthlyLimit = Number(body?.quotaMonthlyLimit ?? 9000);
  const maxClaims = Number(body?.maxClaims) || 1;
  const label = body?.label || null;

  const tokens = await createClaimTokens({
    count, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxClaims, label,
  });

  return NextResponse.json({ success: true, tokens });
}

// DELETE — deactivate
export async function DELETE(request) {
  const authErr = await requireAdmin(request);
  if (authErr) return authErr;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const action = searchParams.get("action") || "deactivate";
  if (action === "delete") {
    await deleteClaimToken(id);
  } else {
    await deactivateClaimToken(id);
  }
  return NextResponse.json({ success: true });
}
