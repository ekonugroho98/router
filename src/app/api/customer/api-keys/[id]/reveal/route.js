// ADDON: saas-mt — Reveal customer API key (one-time per session)
// Note: returns FULL key — UI should hide after first display.
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getCustomerApiKeyById } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const apiKey = await getCustomerApiKeyById(id);
  if (!apiKey) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }
  if (apiKey.customerId !== customer.id) {
    return NextResponse.json({ error: "Not your key" }, { status: 403 });
  }

  return NextResponse.json({
    id: apiKey.id,
    key: apiKey.key, // full key, one-time reveal
    name: apiKey.name,
    isActive: apiKey.isActive,
  });
}
