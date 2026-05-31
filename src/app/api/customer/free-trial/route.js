// ADDON: saas-mt — Check free trial availability + claim
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { listRedeemCodes, redeemCode } from "@/lib/db";
import { activatePlan } from "@/lib/customer/activatePlan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — check if free trial codes are available
export async function GET(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Don't offer free trial if customer already has/had a plan
  if (customer.plan && customer.plan !== "none") {
    return NextResponse.json({ available: false, reason: "already_has_plan" });
  }

  // Check for active free redeem codes
  const codes = await listRedeemCodes();
  const freeCodes = codes.filter(c =>
    c.isActive &&
    c.plan === "free" &&
    c.usedCount < c.maxUses &&
    (!c.expiresAt || new Date(c.expiresAt) > new Date())
  );

  return NextResponse.json({
    available: freeCodes.length > 0,
    slots: freeCodes.length,
    duration: freeCodes[0]?.durationDays || 3,
    dailyQuota: freeCodes[0]?.quotaDailyLimit || 300,
    monthlyQuota: freeCodes[0]?.quotaMonthlyLimit || 9000,
  });
}

// POST — claim a free trial
export async function POST(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (customer.plan && customer.plan !== "none") {
    return NextResponse.json({ error: "Kamu sudah punya plan aktif" }, { status: 400 });
  }

  // Find an available free code
  const codes = await listRedeemCodes();
  const freeCode = codes.find(c =>
    c.isActive &&
    c.plan === "free" &&
    c.usedCount < c.maxUses &&
    (!c.expiresAt || new Date(c.expiresAt) > new Date())
  );

  if (!freeCode) {
    return NextResponse.json({ error: "Free trial tidak tersedia saat ini" }, { status: 404 });
  }

  // Consume the code
  const redeemResult = await redeemCode(freeCode.code);
  if (!redeemResult?.valid) {
    return NextResponse.json({ error: redeemResult?.error || "Gagal redeem" }, { status: 400 });
  }

  // Activate plan
  const result = await activatePlan({
    customerId: customer.id,
    plan: redeemResult.plan,
    durationDays: redeemResult.durationDays,
    quotaDailyLimit: redeemResult.quotaDailyLimit,
    quotaMonthlyLimit: redeemResult.quotaMonthlyLimit,
  });

  return NextResponse.json({
    success: true,
    plan: redeemResult.plan,
    durationDays: redeemResult.durationDays,
    apiKey: result.apiKey ? { id: result.apiKey.id, key: result.apiKey.key } : null,
  });
}
