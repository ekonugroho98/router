// ADDON: saas-mt — Multi-tenant API key identification + quota enforcement
//
// Flow:
//   1. identifyTenant(apiKey) — lookup customer by sk-cortex-xxx API key
//   2. checkQuota(customer) — check daily/monthly limits before forwarding
//   3. logTenantUsage(...) — write to customerUsage table after request
//
// Coexists with existing admin apiKeys table:
//   - If key matches customerApiKeys → tenant flow (with quota + isolation)
//   - If key matches apiKeys (admin) → fall through to admin flow
//   - If key matches neither → reject

import {
  getCustomerByApiKey,
  touchKeyUsed,
  getCustomerUsageToday,
  getCustomerUsageThisMonth,
  logCustomerUsage,
  updateCustomerUsageStatus,
} from "@/lib/db";
import * as log from "../utils/logger.js";

const CUSTOMER_KEY_PREFIX = "sk-cortex-";

/**
 * Identify if an API key belongs to a customer (saas-mt) or is admin/legacy.
 *
 * @param {string} apiKey - raw API key from Authorization header
 * @returns {object|null}
 *   - If customer: { kind: 'customer', customer, apiKey: { id, name } }
 *   - If admin/unknown: null (caller falls back to existing isValidApiKey)
 */
export async function identifyTenant(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  // Fast prefix check — avoid DB lookup for non-customer keys
  if (!apiKey.startsWith(CUSTOMER_KEY_PREFIX)) return null;

  const result = await getCustomerByApiKey(apiKey);
  if (!result) {
    log.warn("TENANT", `Customer key not found or revoked: ${maskKey(apiKey)}`);
    return null;
  }

  // Touch lastUsedAt (throttled internally)
  touchKeyUsed(result.apiKey.id).catch(() => {}); // fire-and-forget

  return {
    kind: "customer",
    customer: result.customer,
    apiKey: result.apiKey,
  };
}

/**
 * Check daily + monthly quota for a customer.
 *
 * @param {object} customer - from identifyTenant().customer
 * @returns {{ ok: boolean, reason?: string, used?: object, limit?: object }}
 */
export async function checkQuota(customer) {
  if (!customer?.id) {
    return { ok: false, reason: "Invalid customer" };
  }

  // 0 = unlimited (skip checks)
  const dailyLimit = customer.quotaDailyLimit ?? 0;
  const monthlyLimit = customer.quotaMonthlyLimit ?? 0;

  if (dailyLimit > 0) {
    const today = await getCustomerUsageToday(customer.id);
    if (today.requests >= dailyLimit) {
      return {
        ok: false,
        reason: "daily_quota_exceeded",
        message: `Daily quota exceeded (${today.requests}/${dailyLimit}). Resets at 00:00 UTC.`,
        used: { today: today.requests },
        limit: { daily: dailyLimit },
      };
    }
  }

  if (monthlyLimit > 0) {
    const month = await getCustomerUsageThisMonth(customer.id);
    if (month.requests >= monthlyLimit) {
      return {
        ok: false,
        reason: "monthly_quota_exceeded",
        message: `Monthly quota exceeded (${month.requests}/${monthlyLimit}). Resets on month change.`,
        used: { month: month.requests },
        limit: { monthly: monthlyLimit },
      };
    }
  }

  return { ok: true };
}

/**
 * Log a tenant request. Returns the usage row ID for later status update.
 *
 * @param {object} tenant - { customer, apiKey } from identifyTenant
 * @param {object} payload - usage data
 * @returns {number|null} - usage row ID (for finalizeTenantUsage)
 */
export async function logTenantUsage(tenant, payload = {}) {
  if (!tenant?.customer?.id) return null;
  try {
    return await logCustomerUsage({
      customerId: tenant.customer.id,
      apiKeyId: tenant.apiKey?.id || null,
      provider: payload.provider || null,
      model: payload.model || null,
      connectionId: payload.connectionId || null,
      promptTokens: payload.promptTokens || 0,
      completionTokens: payload.completionTokens || 0,
      cost: payload.cost || 0,
      status: payload.status || "success",
      errorMessage: payload.errorMessage || null,
      latencyMs: payload.latencyMs || null,
    });
  } catch (e) {
    log.warn("TENANT", `logTenantUsage failed for customer ${tenant.customer.id}: ${e?.message || e}`);
    return null;
  }
}

/**
 * Finalize a pending usage row after upstream request completes.
 * Fire-and-forget — call after streaming response ends.
 *
 * @param {number|null} usageRowId - from logTenantUsage
 * @param {object} result - { status, errorMessage, latencyMs, promptTokens, completionTokens }
 */
export async function finalizeTenantUsage(usageRowId, result = {}) {
  if (!usageRowId) return;
  try {
    await updateCustomerUsageStatus(usageRowId, {
      status: result.status || "success",
      errorMessage: result.errorMessage || null,
      latencyMs: result.latencyMs || null,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
  } catch (e) {
    log.warn("TENANT", `finalizeTenantUsage failed for row ${usageRowId}: ${e?.message || e}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function maskKey(key) {
  if (!key) return "";
  if (key.length < 16) return "***";
  return `${key.slice(0, 12)}...${key.slice(-4)}`;
}
