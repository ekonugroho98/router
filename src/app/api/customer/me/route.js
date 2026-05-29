// ADDON: saas-mt — Customer profile + usage summary endpoint
// Used by /customer/dashboard to render initial state.
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import {
  listCustomerApiKeys,
  getCustomerUsageToday,
  getCustomerUsageThisMonth,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [apiKeys, today, month] = await Promise.all([
    listCustomerApiKeys(customer.id),
    getCustomerUsageToday(customer.id),
    getCustomerUsageThisMonth(customer.id),
  ]);

  // Mask api keys for security — only show first 12 + last 4
  const maskedKeys = apiKeys.map((k) => ({
    id: k.id,
    name: k.name,
    keyMasked: maskKey(k.key),
    isActive: k.isActive,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }));

  return NextResponse.json({
    customer: {
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      plan: customer.plan,
      quotaDailyLimit: customer.quotaDailyLimit,
      quotaMonthlyLimit: customer.quotaMonthlyLimit,
      createdAt: customer.createdAt,
      lastLoginAt: customer.lastLoginAt,
    },
    apiKeys: maskedKeys,
    usage: {
      today,
      month,
    },
    quotas: {
      daily: {
        used: today.requests,
        limit: customer.quotaDailyLimit,
        percent: customer.quotaDailyLimit > 0
          ? Math.min(100, Math.round((today.requests / customer.quotaDailyLimit) * 100))
          : 0,
      },
      monthly: {
        used: month.requests,
        limit: customer.quotaMonthlyLimit,
        percent: customer.quotaMonthlyLimit > 0
          ? Math.min(100, Math.round((month.requests / customer.quotaMonthlyLimit) * 100))
          : 0,
      },
    },
    endpoint: process.env.PUBLIC_API_BASE || "/api/v1",
    // SSH access info from metadata
    ssh: (() => {
      try {
        const meta = typeof customer.metadata === "string" ? JSON.parse(customer.metadata) : (customer.metadata || {});
        if (meta.container && meta.sshPassword) {
          return {
            host: process.env.PUBLIC_SSH_HOST || "20.24.192.82",
            port: meta.sshPort || null,
            user: "hermes",
            password: meta.sshPassword,
            container: meta.container,
          };
        }
      } catch {}
      return null;
    })(),
  });
}

function maskKey(key) {
  if (!key || key.length < 16) return "***";
  return `${key.slice(0, 12)}...${key.slice(-4)}`;
}
