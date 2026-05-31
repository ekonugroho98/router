// ADDON: saas-mt — Customer API keys (1:N relation with customers)
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { getAdapter } from "../driver.js";

const KEY_PREFIX = "sk-cortex-";

function nowIso() {
  return new Date().toISOString();
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customerId,
    key: row.key,
    name: row.name,
    isActive: row.isActive === 1 || row.isActive === true,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Generate a cryptographically secure API key with prefix.
 * Format: sk-cortex-<32-hex-chars> (38 chars total)
 */
export function generateCustomerApiKey() {
  const random = crypto.randomBytes(16).toString("hex"); // 32 hex chars
  return `${KEY_PREFIX}${random}`;
}

export async function createCustomerApiKey({ customerId, name = "default" }) {
  if (!customerId) throw new Error("customerId required");
  const db = await getAdapter();
  const id = uuidv4();
  const key = generateCustomerApiKey();
  const now = nowIso();
  db.run(
    `INSERT INTO customerApiKeys (id, customerId, key, name, isActive, createdAt) VALUES (?, ?, ?, ?, 1, ?)`,
    [id, customerId, key, name, now]
  );
  return {
    id, customerId, key, name,
    isActive: true,
    lastUsedAt: null,
    createdAt: now,
  };
}

export async function getCustomerApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customerApiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

/**
 * Lookup by raw key string (used by multi-tenant middleware).
 * Returns the key row IF active. NULL if not found or revoked.
 */
export async function getCustomerByApiKey(key) {
  if (!key || !key.startsWith(KEY_PREFIX)) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT cak.*, c.id AS customer_id, c.email AS customer_email, c.plan, c.isActive AS customer_active,
            c.quotaDailyLimit, c.quotaMonthlyLimit, c.suspendedReason, c.emailVerified
     FROM customerApiKeys cak
     INNER JOIN customers c ON c.id = cak.customerId
     WHERE cak.key = ? AND cak.isActive = 1`,
    [key]
  );
  if (!row) return null;
  return {
    apiKey: {
      id: row.id,
      key: row.key,
      name: row.name,
      customerId: row.customerId,
    },
    customer: {
      id: row.customer_id,
      email: row.customer_email,
      plan: row.plan,
      isActive: row.customer_active === 1,
      status: row.customer_active === 1 ? "active" : "suspended",
      suspendedReason: row.suspendedReason,
      quotaDailyLimit: row.quotaDailyLimit,
      quotaMonthlyLimit: row.quotaMonthlyLimit,
      emailVerified: row.emailVerified === 1,
    },
  };
}

export async function listCustomerApiKeys(customerId) {
  if (!customerId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM customerApiKeys WHERE customerId = ? ORDER BY createdAt DESC`,
    [customerId]
  );
  return rows.map(rowToKey);
}

export async function revokeCustomerApiKey(id) {
  const db = await getAdapter();
  db.run(`UPDATE customerApiKeys SET isActive = 0 WHERE id = ?`, [id]);
  return true;
}

export async function deleteCustomerApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM customerApiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Update lastUsedAt — called by middleware on every successful API call.
 * Throttled to once per minute per key to avoid write-heavy churn.
 */
const _lastUpdateCache = new Map();
export async function touchKeyUsed(id) {
  if (!id) return;
  const now = Date.now();
  const cached = _lastUpdateCache.get(id);
  if (cached && now - cached < 60_000) return; // throttle 60s
  _lastUpdateCache.set(id, now);
  const db = await getAdapter();
  db.run(`UPDATE customerApiKeys SET lastUsedAt = ? WHERE id = ?`, [nowIso(), id]);
}

/**
 * Regenerate the key string for an existing key entry (rotate without losing usage history).
 */
export async function regenerateCustomerApiKey(id) {
  const db = await getAdapter();
  const newKey = generateCustomerApiKey();
  db.run(`UPDATE customerApiKeys SET key = ?, lastUsedAt = NULL WHERE id = ?`, [newKey, id]);
  return getCustomerApiKeyById(id);
}
