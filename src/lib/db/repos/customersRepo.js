// ADDON: saas-mt — Customers repo (signup, login lookup, profile, admin CRUD)
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function nowIso() {
  return new Date().toISOString();
}

function rowToCustomer(row) {
  if (!row) return null;
  const { passwordHash, metadata, isActive, emailVerified, ...rest } = row;
  return {
    ...rest,
    isActive: isActive === 1 || isActive === true,
    emailVerified: emailVerified === 1 || emailVerified === true,
    metadata: metadata ? safeJsonParse(metadata) : null,
  };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Create a new customer (signup).
 * @param {object} args
 * @returns {object} Created customer (passwordHash stripped)
 */
export async function createCustomer({
  email,
  passwordHash = null,
  googleId = null,
  emailVerified = false,
  displayName = null,
  plan = "free",
  quotaDailyLimit = 1000,
  quotaMonthlyLimit = 30000,
  metadata = null,
}) {
  const db = await getAdapter();
  const id = uuidv4();
  const now = nowIso();
  db.run(
    `INSERT INTO customers (id, email, passwordHash, googleId, emailVerified, displayName, plan, quotaDailyLimit, quotaMonthlyLimit, isActive, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      email.toLowerCase(),
      passwordHash,
      googleId,
      emailVerified ? 1 : 0,
      displayName,
      plan,
      quotaDailyLimit,
      quotaMonthlyLimit,
      metadata ? JSON.stringify(metadata) : null,
      now,
      now,
    ]
  );
  return getCustomerById(id);
}

/**
 * Find customer by Google ID.
 */
export async function getCustomerByGoogleId(googleId) {
  if (!googleId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customers WHERE googleId = ?`, [googleId]);
  return rowToCustomer(row);
}

export async function getCustomerById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customers WHERE id = ?`, [id]);
  return rowToCustomer(row);
}

export async function getCustomerByEmail(email) {
  if (!email) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customers WHERE email = ?`, [email.toLowerCase()]);
  return rowToCustomer(row);
}

/**
 * Lookup for login — includes passwordHash. ONLY use in auth/login route.
 */
export async function getCustomerForAuth(email) {
  if (!email) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customers WHERE email = ? AND isActive = 1`, [email.toLowerCase()]);
  if (!row) return null;
  return {
    ...rowToCustomer(row),
    passwordHash: row.passwordHash, // re-attach for auth check
  };
}

export async function listCustomers({ limit = 100, offset = 0, plan = null, isActive = null, search = null } = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (plan) { where.push("plan = ?"); params.push(plan); }
  if (isActive !== null) { where.push("isActive = ?"); params.push(isActive ? 1 : 0); }
  if (search) { where.push("(email LIKE ? OR displayName LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM customers ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows.map(rowToCustomer);
}

export async function countCustomers({ plan = null, isActive = null, search = null } = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (plan) { where.push("plan = ?"); params.push(plan); }
  if (isActive !== null) { where.push("isActive = ?"); params.push(isActive ? 1 : 0); }
  if (search) { where.push("(email LIKE ? OR displayName LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const row = db.get(`SELECT COUNT(*) AS c FROM customers ${whereSql}`, params);
  return row?.c || 0;
}

/**
 * Update customer fields (admin-only for sensitive, customer-self for displayName).
 */
export async function updateCustomer(id, patch) {
  const db = await getAdapter();
  const allowed = [
    "displayName", "plan", "quotaDailyLimit", "quotaMonthlyLimit",
    "isActive", "suspendedReason", "metadata", "passwordHash", "lastLoginAt",
    "emailVerified", "googleId",
  ];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k} = ?`);
      const v = patch[k];
      if (k === "metadata" && v != null && typeof v === "object") {
        params.push(JSON.stringify(v));
      } else if (k === "isActive" || k === "emailVerified") {
        params.push(v ? 1 : 0);
      } else {
        params.push(v);
      }
    }
  }
  if (sets.length === 0) return getCustomerById(id);
  sets.push("updatedAt = ?");
  params.push(nowIso());
  params.push(id);
  db.run(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`, params);
  return getCustomerById(id);
}

export async function deleteCustomer(id) {
  const db = await getAdapter();
  db.transaction(() => {
    // Cascade: delete dependent rows first
    db.run(`DELETE FROM customerApiKeys WHERE customerId = ?`, [id]);
    db.run(`DELETE FROM customerSessions WHERE customerId = ?`, [id]);
    db.run(`DELETE FROM customerUsage WHERE customerId = ?`, [id]);
    db.run(`DELETE FROM customers WHERE id = ?`, [id]);
  });
  return true;
}

export async function touchLastLogin(id) {
  const db = await getAdapter();
  db.run(`UPDATE customers SET lastLoginAt = ? WHERE id = ?`, [nowIso(), id]);
}
