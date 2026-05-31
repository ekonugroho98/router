// ADDON: saas-mt — Google OAuth login/signup
// Receives Google id_token from frontend, verifies, creates/logs in customer
import { NextResponse } from "next/server";
import {
  getCustomerByEmail,
  getCustomerByGoogleId,
  createCustomer,
  updateCustomer,
  createCustomerApiKey,
  createCustomerSession,
  touchLastLogin,
} from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/customer/rateLimit";

const SESSION_COOKIE = "cortex_session";
const SESSION_TTL_DAYS = 30;

const googleLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, message: "Too many attempts. Try again later." });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Verify Google id_token via Google's tokeninfo endpoint.
 */
async function verifyGoogleToken(idToken) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const payload = await res.json();

  // Verify audience matches our client ID
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (clientId && payload.aud !== clientId) return null;

  // Must have email
  if (!payload.email) return null;

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === "true",
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

export async function POST(request) {
  const rl = googleLimiter.check(getClientIp(request));
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { idToken } = body;
  if (!idToken) {
    return NextResponse.json({ error: "idToken required" }, { status: 400 });
  }

  // Verify with Google
  const googleUser = await verifyGoogleToken(idToken);
  if (!googleUser) {
    return NextResponse.json({ error: "Invalid Google token" }, { status: 401 });
  }

  // Only allow @gmail.com — block GSuite/Workspace emails to prevent abuse
  if (!googleUser.email.endsWith("@gmail.com")) {
    return NextResponse.json({
      error: "Hanya akun @gmail.com yang diperbolehkan. Email Google Workspace tidak didukung.",
    }, { status: 403 });
  }

  let customer;
  let isNew = false;
  let apiKey = null;

  // Check if customer exists by Google ID
  customer = await getCustomerByGoogleId(googleUser.googleId);

  if (!customer) {
    // Check if customer exists by email (could have signed up with password before)
    customer = await getCustomerByEmail(googleUser.email);

    if (customer) {
      // Link Google ID to existing account + mark email as verified
      await updateCustomer(customer.id, {
        googleId: googleUser.googleId,
        emailVerified: true,
        displayName: customer.displayName || googleUser.name,
      });
      customer = await getCustomerByEmail(googleUser.email);
    } else {
      // Create new account (auto-verified, free trial)
      customer = await createCustomer({
        email: googleUser.email,
        passwordHash: null, // no password for Google-only users
        googleId: googleUser.googleId,
        emailVerified: true,
        displayName: googleUser.name,
        plan: "free",
        quotaDailyLimit: 1000,
        quotaMonthlyLimit: 30000,
        metadata: {
          authMethod: "google",
          picture: googleUser.picture,
        },
      });
      isNew = true;

      // Auto-generate first API key
      apiKey = await createCustomerApiKey({
        customerId: customer.id,
        name: "default",
      });

      // Notify admin
      notifyAdmin(googleUser.email, "google").catch(() => {});
    }
  }

  if (!customer.isActive) {
    return NextResponse.json({ error: "Akun dinonaktifkan" }, { status: 403 });
  }

  // Update last login
  touchLastLogin(customer.id).catch(() => {});

  // Create session
  const session = await createCustomerSession({
    customerId: customer.id,
    userAgent: request.headers.get("user-agent"),
    ipAddress: getClientIp(request),
  });

  const res = NextResponse.json({
    success: true,
    isNew,
    customer: {
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      plan: customer.plan,
      emailVerified: true,
    },
    ...(apiKey ? { apiKey: { id: apiKey.id, key: apiKey.key, name: apiKey.name } } : {}),
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

async function notifyAdmin(email, method) {
  const token = process.env.ADMIN_TG_BOT_TOKEN;
  const chatId = process.env.ADMIN_TG_CHAT_ID;
  if (!token || !chatId) return;
  const msg = `*Signup Baru (${method})*\n\nEmail: \`${email}\``;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
}
