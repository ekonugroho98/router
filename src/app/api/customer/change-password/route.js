// ADDON: saas-mt — Customer change password (requires current password)
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getCustomerForAuth, updateCustomer } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/customer/rateLimit";

// 5 attempts per 15 minutes
const changePwLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5 });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const rl = changePwLimiter.check(getClientIp(request));
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

  const customer = await getCustomerFromRequest(request);
  if (!customer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const currentPassword = String(body?.currentPassword || "");
  const newPassword = String(body?.newPassword || "");

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password required" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  // Verify current password
  const authData = await getCustomerForAuth(customer.email);
  if (!authData) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, authData.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  // Hash new password and update
  const newHash = await bcrypt.hash(newPassword, 10);
  await updateCustomer(customer.id, { passwordHash: newHash });

  return NextResponse.json({ success: true });
}
