// ADDON: saas-mt — Public claim endpoint
// POST: validates token + email → generates redeem code → returns code
import { NextResponse } from "next/server";
import { claimToken } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — redirect to claim page with token
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  // Redirect to claim page (client-side form)
  const url = new URL("/customer/claim", request.url);
  url.searchParams.set("token", token);
  return NextResponse.redirect(url);
}

// POST — validate + generate code
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token, email } = body || {};
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Email harus diisi" }, { status: 400 });

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Format email tidak valid" }, { status: 400 });
  }

  const result = await claimToken(token, email);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
