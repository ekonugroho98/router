// ADDON: saas-mt — Regenerate customer API key (rotate without losing key id)
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getCustomerApiKeyById, regenerateCustomerApiKey } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
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
