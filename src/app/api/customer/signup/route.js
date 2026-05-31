// ADDON: saas-mt — Customer signup endpoint
// Creates account ONLY — no API key, no quota, no plan.
// User must purchase a plan or claim a code to get API key + quota.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  getCustomerByEmail,
  createCustomer,
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
    return NextResponse.json({ error: "Format email tidak valid" }, { status: 400 });
  }
  if (!email.endsWith("@gmail.com")) {
    return NextResponse.json({ error: "Hanya email @gmail.com yang diperbolehkan. Atau gunakan Sign in with Google." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password minimal 8 karakter" }, { status: 400 });
  }

  // Check uniqueness
  const existing = await getCustomerByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Create account ONLY — no plan, no quota, no API key
  const customer = await createCustomer({
    email,
    passwordHash,
    emailVerified: false,
    displayName,
    plan: "none",           // no active plan
    quotaDailyLimit: 0,     // no quota until plan purchased
    quotaMonthlyLimit: 0,
  });

  // Notify admin
  notifyAdminSignup(email).catch(() => {});

  // Create session + cookie
  const session = await createCustomerSession({
    customerId: customer.id,
    userAgent: request.headers.get("user-agent"),
    ipAddress: getClientIp(request),
  });

  const res = NextResponse.json({
    success: true,
    customer: {
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      plan: customer.plan,
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

async function notifyAdminSignup(email) {
  const token = process.env.ADMIN_TG_BOT_TOKEN;
  const chatId = process.env.ADMIN_TG_CHAT_ID;
  if (!token || !chatId) return;
  const msg = `*Signup Baru*\n\nEmail: \`${email}\`\nPlan: none (belum beli)`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
}
