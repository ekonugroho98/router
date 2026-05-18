// ADDON: saas-mt — Regenerate customer API key (rotate without losing key id)
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getCustomerApiKeyById, regenerateCustomerApiKey } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/customer/rateLimit";

// 3 regenerates per IP per 15 minutes
const regenLimiter = rateLimit({ windowMs: 15 * 60_000, max: 3 });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  const rl = regenLimiter.check(getClientIp(request));
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

  const customer = await getCustomerFromRequest(request);
  if (!customer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await getCustomerApiKeyById(id);
  if (!existing) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }
  if (existing.customerId !== customer.id) {
    return NextResponse.json({ error: "Not your key" }, { status: 403 });
  }

  const rotated = await regenerateCustomerApiKey(id);
  return NextResponse.json({
    id: rotated.id,
    key: rotated.key, // new key — show once
    name: rotated.name,
    isActive: rotated.isActive,
  });
}
