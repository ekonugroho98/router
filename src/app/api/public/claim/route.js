// ADDON: saas-mt — Public claim endpoint (no auth required)
// Customer clicks link → validates token → generates redeem code → redirects to activate
import { NextResponse } from "next/server";
import { claimToken } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const result = await claimToken(token);

  if (result.error) {
    // Redirect to activate page with error
    const url = new URL("/customer/activate", request.url);
    url.searchParams.set("error", result.error);
    return NextResponse.redirect(url);
  }

  // Success — redirect to activate page with code pre-filled
  const url = new URL("/customer/activate", request.url);
  url.searchParams.set("code", result.code);
  url.searchParams.set("plan", result.plan);
  return NextResponse.redirect(url);
}
