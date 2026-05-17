// ADDON: saas-mt — Customer login endpoint
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  getCustomerForAuth,
  touchLastLogin,
  createCustomerSession,
} from "@/lib/db";

const SESSION_COOKIE = "cortex_session";
const SESSION_TTL_DAYS = 30;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const customer = await getCustomerForAuth(email);
  if (!customer) {
    // Generic message — don't reveal whether email exists
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, customer.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Update lastLoginAt + create session
  touchLastLogin(customer.id).catch(() => {});

  const userAgent = request.headers.get("user-agent") || null;
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || null;
  const session = await createCustomerSession({
    customerId: customer.id,
    userAgent,
    ipAddress,
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
