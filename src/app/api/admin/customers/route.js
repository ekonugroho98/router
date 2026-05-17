// ADDON: saas-mt — Admin API: list + create customers
// NOTE: This relies on existing 9router admin auth (cookie-based dashboard auth).
// In MVP we trust that /dashboard/* is already gated by the upstream auth flow.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  listCustomers,
  countCustomers,
  createCustomer,
  createCustomerApiKey,
  getCustomersUsageSummary,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(500, parseInt(searchParams.get("limit") || "100", 10));
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const plan = searchParams.get("plan") || null;
  const isActiveParam = searchParams.get("isActive");
  const isActive = isActiveParam == null ? null : isActiveParam === "true";
  const search = searchParams.get("search") || null;

  const [customers, total] = await Promise.all([
    listCustomers({ limit, offset, plan, isActive, search }),
    countCustomers({ plan, isActive, search }),
  ]);

  // Bulk fetch today's usage for visible customers
  const ids = customers.map((c) => c.id);
  const usage = ids.length ? await getCustomersUsageSummary(ids, { period: "today" }) : {};

  return NextResponse.json({
    customers: customers.map((c) => ({
      ...c,
      usageToday: usage[c.id] || { requests: 0, tokens: 0 },
    })),
    total,
    limit,
    offset,
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const displayName = body?.displayName ? String(body.displayName).trim() : null;
  const plan = body?.plan || "free";
  const quotaDailyLimit = Number(body?.quotaDailyLimit ?? 1000);
  const quotaMonthlyLimit = Number(body?.quotaMonthlyLimit ?? 30000);

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password too short (min 8 chars)" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let customer;
  try {
    customer = await createCustomer({
      email,
      passwordHash,
      displayName,
      plan,
      quotaDailyLimit,
      quotaMonthlyLimit,
    });
  } catch (e) {
    if (String(e.message || e).includes("UNIQUE")) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }

  // Auto-create first API key
  const apiKey = await createCustomerApiKey({
    customerId: customer.id,
    name: "default",
  });

  return NextResponse.json({
    success: true,
    customer,
    apiKey: {
      id: apiKey.id,
      key: apiKey.key, // revealed once
      name: apiKey.name,
    },
  });
}
