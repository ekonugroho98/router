// ADDON: saas-mt — Customer Telegram bot configuration
// Stores bot token + owner chat ID in customer.metadata.telegram
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getCustomerById, updateCustomer } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — retrieve current telegram config (masked token)
export async function GET(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const full = await getCustomerById(customer.id);
  const tg = full?.metadata?.telegram || {};

  return NextResponse.json({
    configured: !!(tg.botToken && tg.ownerId),
    botToken: tg.botToken ? `${tg.botToken.slice(0, 8)}...${tg.botToken.slice(-4)}` : null,
    ownerId: tg.ownerId || null,
    botUsername: tg.botUsername || null,
    status: tg.status || "inactive", // 'inactive' | 'active' | 'error'
    lastError: tg.lastError || null,
  });
}

// POST — save telegram bot config
export async function POST(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const botToken = String(body?.botToken || "").trim();
  const ownerId = String(body?.ownerId || "").trim();

  if (!botToken) return NextResponse.json({ error: "Bot token required" }, { status: 400 });
  if (!ownerId) return NextResponse.json({ error: "Owner chat ID required" }, { status: 400 });

  // Validate token format (number:alphanum)
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    return NextResponse.json({ error: "Invalid bot token format. Expected: 123456789:ABCdef..." }, { status: 400 });
  }
  // Validate owner ID (numeric)
  if (!/^\d+$/.test(ownerId)) {
    return NextResponse.json({ error: "Owner ID must be numeric (e.g. 1433257992)" }, { status: 400 });
  }

  // Verify bot token with Telegram API
  let botUsername = null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (!data.ok) {
      return NextResponse.json({ error: `Invalid bot token: ${data.description || "Telegram rejected"}` }, { status: 400 });
    }
    botUsername = data.result?.username || null;
  } catch (e) {
    return NextResponse.json({ error: `Could not verify bot token: ${e.message}` }, { status: 400 });
  }

  // Save to customer metadata
  const full = await getCustomerById(customer.id);
  const metadata = full?.metadata || {};
  metadata.telegram = {
    botToken,
    ownerId,
    botUsername,
    status: "configured",
    configuredAt: new Date().toISOString(),
  };

  await updateCustomer(customer.id, { metadata });

  return NextResponse.json({
    success: true,
    botUsername,
    message: `Bot @${botUsername} configured! It will be activated shortly.`,
  });
}

// DELETE — remove telegram config
export async function DELETE(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const full = await getCustomerById(customer.id);
  const metadata = full?.metadata || {};
  delete metadata.telegram;

  await updateCustomer(customer.id, { metadata });
  return NextResponse.json({ success: true });
}
