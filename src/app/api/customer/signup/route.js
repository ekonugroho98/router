// ADDON: saas-mt — Customer signup endpoint
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  getCustomerByEmail,
  createCustomer,
  createCustomerApiKey,
  createCustomerSession,
} from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/customer/rateLimit";

const SESSION_COOKIE = "cortex_session";
const SESSION_TTL_DAYS = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 5 signups per IP per 15 minutes
const signupLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5, message: "Too many signups. Try again later." });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const rl = signupLimiter.check(getClientIp(request));
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const displayName = body?.displayName ? String(body.displayName).trim() : null;

  // Validation
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Check uniqueness
  const existing = await getCustomerByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  // Hash password (bcrypt rounds = 10 — balanced security/speed)
  const passwordHash = await bcrypt.hash(password, 10);

  // Create customer (free plan default)
  const customer = await createCustomer({
    email,
    passwordHash,
    displayName,
    plan: "free",
    quotaDailyLimit: 1000,
    quotaMonthlyLimit: 30000,
  });

  // Auto-generate first API key
  const apiKey = await createCustomerApiKey({
    customerId: customer.id,
    name: "default",
  });

  // Notify admin
  notifyAdminSignup(email, customer.plan).catch(() => {});

  // Create session + cookie
  const userAgent = request.headers.get("user-agent") || null;
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || null;
  const session = await createCustomerSession({
    customerId: customer.id,
    userAgent,
    ipAddress,
  });

  // Response with session cookie + first API key revealed once (clipboard-friendly)
  const res = NextResponse.json({
    success: true,
    customer: {
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      plan: customer.plan,
    },
    apiKey: {
      id: apiKey.id,
      key: apiKey.key, // ← revealed once on signup
      name: apiKey.name,
    },
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

async function notifyAdminSignup(email, plan) {
  const token = process.env.ADMIN_TG_BOT_TOKEN;
  const chatId = process.env.ADMIN_TG_CHAT_ID;
  if (!token || !chatId) return;
  const msg = `📝 *Signup Baru (tanpa kode)*\n\n📧 Email: \`${email}\`\n📋 Plan: ${plan}`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
}
