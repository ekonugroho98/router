// ADDON: saas-mt — Customer activation via redemption code
// POST: validate code → return plan info
// PUT: redeem code + create account + setup telegram
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  redeemCode,
  getCustomerByEmail,
  createCustomer,
  createCustomerApiKey,
  createCustomerSession,
  updateCustomer,
  getCustomerById,
} from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/customer/rateLimit";

const SESSION_COOKIE = "cortex_session";
const SESSION_TTL_DAYS = 30;

// 10 attempts per IP per 15 minutes
const activateLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10 });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — validate code (step 1)
export async function POST(request) {
  const rl = activateLimiter.check(getClientIp(request));
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = String(body?.code || "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Kode aktivasi diperlukan" }, { status: 400 });

  // Peek at code without consuming it
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM redeemCodes WHERE code = ?`, [code]);

  if (!row) return NextResponse.json({ error: "Kode tidak ditemukan" }, { status: 404 });
  if (!row.isActive) return NextResponse.json({ error: "Kode sudah dinonaktifkan" }, { status: 400 });
  if (row.usedCount >= row.maxUses) return NextResponse.json({ error: "Kode sudah digunakan" }, { status: 400 });
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return NextResponse.json({ error: "Kode sudah kadaluarsa" }, { status: 400 });

  return NextResponse.json({
    valid: true,
    plan: row.plan,
    durationDays: row.durationDays,
    quotaDailyLimit: row.quotaDailyLimit,
    quotaMonthlyLimit: row.quotaMonthlyLimit,
  });
}

// PUT — redeem code + create account + setup telegram
export async function PUT(request) {
  const rl = activateLimiter.check(getClientIp(request));
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = String(body?.code || "").trim().toUpperCase();
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const displayName = body?.displayName ? String(body.displayName).trim() : null;
  const botToken = body?.botToken ? String(body.botToken).trim() : null;
  const ownerIdStr = body?.ownerId ? String(body.ownerId).trim() : null;

  if (!code) return NextResponse.json({ error: "Kode aktivasi diperlukan" }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Email tidak valid" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password minimal 8 karakter" }, { status: 400 });

  // Check email uniqueness
  const existing = await getCustomerByEmail(email);
  if (existing) return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });

  // Redeem code (consumes 1 use)
  const codeResult = await redeemCode(code);
  if (!codeResult) return NextResponse.json({ error: "Kode tidak ditemukan" }, { status: 404 });
  if (codeResult.error) return NextResponse.json({ error: codeResult.error }, { status: 400 });
  if (!codeResult.valid) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });

  // Calculate expiry
  const expiresAt = new Date(Date.now() + codeResult.durationDays * 24 * 60 * 60 * 1000).toISOString();

  // Create customer
  const passwordHash = await bcrypt.hash(password, 10);
  const customer = await createCustomer({
    email,
    passwordHash,
    displayName,
    plan: codeResult.plan,
    quotaDailyLimit: codeResult.quotaDailyLimit,
    quotaMonthlyLimit: codeResult.quotaMonthlyLimit,
    metadata: {
      activatedWith: code,
      expiresAt,
      durationDays: codeResult.durationDays,
      provisionStatus: "pending",
    },
  });

  // Create API key
  const apiKey = await createCustomerApiKey({ customerId: customer.id, name: "default" });

  // Setup Telegram if provided
  let botUsername = null;
  if (botToken && ownerIdStr) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(10000) });
      const tgData = await tgRes.json();
      if (tgData.ok) {
        botUsername = tgData.result?.username || null;
        const full = await getCustomerById(customer.id);
        const metadata = full?.metadata || {};
        metadata.telegram = {
          botToken,
          ownerId: ownerIdStr,
          botUsername,
          status: "configured",
          configuredAt: new Date().toISOString(),
        };
        await updateCustomer(customer.id, { metadata });
      }
    } catch {}
  }

  // Notify admin via Telegram
  notifyAdmin({
    email, plan: codeResult.plan, durationDays: codeResult.durationDays,
    code, botUsername, customerId: customer.id, apiKey: apiKey.key,
  }).catch(() => {});

  // Create session
  const session = await createCustomerSession({
    customerId: customer.id,
    userAgent: request.headers.get("user-agent"),
    ipAddress: getClientIp(request),
  });

  const res = NextResponse.json({
    success: true,
    customer: { id: customer.id, email: customer.email, plan: customer.plan },
    apiKey: { id: apiKey.id, key: apiKey.key, name: apiKey.name },
    botUsername,
    expiresAt,
    durationDays: codeResult.durationDays,
  });

  res.cookies.set(SESSION_COOKIE, session.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    path: "/",
  });

  return res;
}

// Admin Telegram notification
const ADMIN_BOT_TOKEN = process.env.ADMIN_TG_BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_TG_CHAT_ID || "";

async function notifyAdmin({ email, plan, durationDays, code, botUsername, customerId, apiKey }) {
  const expiryDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
    .toLocaleDateString("id-ID", { dateStyle: "full" });

  const msg = [
    `🆕 *Customer Baru Redeem Kode!*`,
    ``,
    `📧 Email: \`${email}\``,
    `📋 Plan: *${plan}* (${durationDays} hari)`,
    `🔑 Kode: \`${code}\``,
    `📅 Expired: ${expiryDate}`,
    botUsername ? `🤖 Bot: @${botUsername}` : `🤖 Bot: belum setup`,
    ``,
    `*Provision command:*`,
    `\`\`\``,
    `sudo bash /opt/9router/provision-hermes.sh \\`,
    `  --customer-id "${customerId}" \\`,
    `  --api-key "${apiKey}" ${botUsername ? `\\` : ''}`,
    botUsername ? `  --bot-token "AMBIL_DARI_DB" \\` : null,
    botUsername ? `  --owner-id "AMBIL_DARI_DB"` : null,
    `\`\`\``,
  ].filter(Boolean).join("\n");

  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
}
