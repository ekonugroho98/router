// ADDON: saas-mt — Customer logout endpoint
import { NextResponse } from "next/server";
import { verifyCustomerSession, deleteCustomerSession } from "@/lib/db";

const SESSION_COOKIE = "cortex_session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookieValue) {
    const session = await verifyCustomerSession(cookieValue);
    if (session?.sessionId) {
      await deleteCustomerSession(session.sessionId).catch(() => {});
    }
  }

  const res = NextResponse.json({ success: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
