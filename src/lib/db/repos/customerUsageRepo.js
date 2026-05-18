// ADDON: saas-mt — Customer usage log + aggregation helpers
import { getAdapter } from "../driver.js";

function nowIso() {
  return new Date().toISOString();
}

function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Log a single API request from a customer.
 * Returns the inserted row ID so the caller can update status later.
 */
export async function logCustomerUsage({
  customerId,
  apiKeyId = null,
  provider = null,
  model = null,
  connectionId = null,
  promptTokens = 0,
  completionTokens = 0,
  cost = 0,
  status = "success",     // 'pending' | 'success' | 'error' | 'quota_exceeded' | 'auth_fail'
  errorMessage = null,
  latencyMs = null,
} = {}) {
  if (!customerId) throw new Error("customerId required");
  const db = await getAdapter();
  const now = new Date();
  const res = db.run(
    `INSERT INTO customerUsage
      (customerId, apiKeyId, timestamp, dateKey, monthKey, provider, model, connectionId,
       promptTokens, completionTokens, cost, status, errorMessage, latencyMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customerId,
      apiKeyId,
      now.toISOString(),
      dateKey(now),
      monthKey(now),
      provider,
      model,
      connectionId,
      promptTokens || 0,
      completionTokens || 0,
      cost || 0,
      status,
      errorMessage,
      latencyMs,
    ]
  );
  return res?.lastInsertRowid ?? null;
}

/**
 * Update a pending usage row to final status after request completes.
 */
export async function updateCustomerUsageStatus(rowId, { status, errorMessage, latencyMs, promptTokens, completionTokens } = {}) {
  if (!rowId) return;
  const db = await getAdapter();
  const sets = ["status = ?"];
  const vals = [status || "success"];
  if (errorMessage !== undefined) { sets.push("errorMessage = ?"); vals.push(errorMessage); }
  if (latencyMs !== undefined) { sets.push("latencyMs = ?"); vals.push(latencyMs); }
  if (promptTokens !== undefined) { sets.push("promptTokens = ?"); vals.push(promptTokens); }
  if (completionTokens !== undefined) { sets.push("completionTokens = ?"); vals.push(completionTokens); }
  vals.push(rowId);
  db.run(`UPDATE customerUsage SET ${sets.join(", ")} WHERE id = ?`, vals);
}

/**
 * Count successful requests today (UTC) for a customer.
 * Used by middleware to enforce daily quota.
 */
export async function getCustomerUsageToday(customerId) {
  if (!customerId) return { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  const db = await getAdapter();
  const today = dateKey();
  const row = db.get(
    `SELECT COUNT(*) AS requests,
            SUM(promptTokens) AS promptTokens,
            SUM(completionTokens) AS completionTokens,
            SUM(cost) AS cost
     FROM customerUsage
     WHERE customerId = ? AND dateKey = ? AND status IN ('success', 'pending')`,
    [customerId, today]
  );
  return {
    requests: row?.requests || 0,
    promptTokens: row?.promptTokens || 0,
    completionTokens: row?.completionTokens || 0,
    cost: row?.cost || 0,
  };
}

/**
 * Count successful requests this month (UTC) for a customer.
 */
export async function getCustomerUsageThisMonth(customerId) {
  if (!customerId) return { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  const db = await getAdapter();
  const month = monthKey();
  const row = db.get(
    `SELECT COUNT(*) AS requests,
            SUM(promptTokens) AS promptTokens,
            SUM(completionTokens) AS completionTokens,
            SUM(cost) AS cost
     FROM customerUsage
     WHERE customerId = ? AND monthKey = ? AND status IN ('success', 'pending')`,
    [customerId, month]
  );
  return {
    requests: row?.requests || 0,
    promptTokens: row?.promptTokens || 0,
    completionTokens: row?.completionTokens || 0,
    cost: row?.cost || 0,
  };
}

/**
 * Get daily usage breakdown for last N days (for chart).
 */
export async function getCustomerUsageDaily(customerId, days = 30) {
  if (!customerId) return [];
  const db = await getAdapter();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = db.all(
    `SELECT dateKey, COUNT(*) AS requests,
            SUM(promptTokens) AS promptTokens,
            SUM(completionTokens) AS completionTokens,
            SUM(cost) AS cost
     FROM customerUsage
     WHERE customerId = ? AND timestamp >= ? AND status = 'success'
     GROUP BY dateKey
     ORDER BY dateKey ASC`,
    [customerId, since.toISOString()]
  );
  return rows.map((r) => ({
    date: r.dateKey,
    requests: r.requests || 0,
    promptTokens: r.promptTokens || 0,
    completionTokens: r.completionTokens || 0,
    cost: r.cost || 0,
  }));
}

/**
 * Get recent request history for customer dashboard (limit + offset paginated).
 */
export async function getCustomerUsageRecent(customerId, { limit = 50, offset = 0 } = {}) {
  if (!customerId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, timestamp, provider, model, status, promptTokens, completionTokens, cost, errorMessage, latencyMs
     FROM customerUsage
     WHERE customerId = ?
     ORDER BY timestamp DESC
     LIMIT ? OFFSET ?`,
    [customerId, limit, offset]
  );
  return rows;
}

/**
 * Admin-side: get usage stats per customer for the Customers list page.
 */
export async function getCustomersUsageSummary(customerIds, { period = "today" } = {}) {
  if (!Array.isArray(customerIds) || customerIds.length === 0) return {};
  const db = await getAdapter();
  const placeholders = customerIds.map(() => "?").join(",");
  const filter = period === "month" ? `monthKey = ?` : `dateKey = ?`;
  const keyVal = period === "month" ? monthKey() : dateKey();
  const rows = db.all(
    `SELECT customerId, COUNT(*) AS requests,
            SUM(promptTokens + completionTokens) AS tokens
     FROM customerUsage
     WHERE customerId IN (${placeholders}) AND ${filter} AND status = 'success'
     GROUP BY customerId`,
    [...customerIds, keyVal]
  );
  const result = {};
  for (const r of rows) {
    result[r.customerId] = {
      requests: r.requests || 0,
      tokens: r.tokens || 0,
    };
  }
  return result;
}

/**
 * Prune old usage rows (called by cron / cleanup job).
 * Default keep 90 days of history.
 */
export async function pruneOldUsage(keepDays = 90) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  const res = db.run(`DELETE FROM customerUsage WHERE timestamp < ?`, [cutoff]);
  return res?.changes ?? 0;
}
