// ADDON: saas-mt — Customer session storage (cookie-based auth)
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

const SESSION_TTL_DAYS = 30;

function nowIso() {
  return new Date().toISOString();
}

function genToken() {
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars
}

/**
 * Create a new session for a customer. Returns:
 *   { sessionId, token } — give 'sessionId.token' to the client as cookie value
 *
 * Why split? sessionId is the lookup key (indexed), token is the bearer secret
 * (hash-compared). Even if DB leaks, attacker still needs the plaintext token.
 */
export async function createCustomerSession({ customerId, userAgent = null, ipAddress = null, ttlDays = SESSION_TTL_DAYS } = {}) {
  if (!customerId) throw new Error("customerId required");
  const db = await getAdapter();
  const sessionId = uuidv4();
  const token = genToken();
  const tokenHash = await bcrypt.hash(token, 8); // low rounds — fast verify, this is read on every request
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  db.run(
    `INSERT INTO customerSessions (id, customerId, tokenHash, userAgent, ipAddress, createdAt, expiresAt, lastSeenAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, customerId, tokenHash, userAgent, ipAddress, nowIso(), expiresAt.toISOString(), nowIso()]
  );
  return {
    sessionId,
    token,
    expiresAt,
    cookieValue: `${sessionId}.${token}`, // ready-to-use cookie string
  };
}

/**
 * Verify a cookie value of form "sessionId.token". Returns:
 *   { customerId } on success, null if invalid/expired.
 *
 * Updates lastSeenAt on hit (throttled).
 */
const _lastSeenCache = new Map();
export async function verifyCustomerSession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const dotIdx = cookieValue.indexOf(".");
  if (dotIdx === -1) return null;
  const sessionId = cookieValue.slice(0, dotIdx);
  const token = cookieValue.slice(dotIdx + 1);
  if (!sessionId || !token) return null;

  const db = await getAdapter();
  const row = db.get(
    `SELECT customerId, tokenHash, expiresAt FROM customerSessions WHERE id = ?`,
    [sessionId]
  );
  if (!row) return null;

  // Check expiry
  if (new Date(row.expiresAt) < new Date()) {
    db.run(`DELETE FROM customerSessions WHERE id = ?`, [sessionId]); // cleanup
    return null;
  }

  // Bcrypt-verify token
  const ok = await bcrypt.compare(token, row.tokenHash);
  if (!ok) return null;

  // Throttled lastSeenAt update (5 min)
  const cached = _lastSeenCache.get(sessionId);
  const now = Date.now();
  if (!cached || now - cached > 5 * 60 * 1000) {
    _lastSeenCache.set(sessionId, now);
    db.run(`UPDATE customerSessions SET lastSeenAt = ? WHERE id = ?`, [nowIso(), sessionId]);
  }

  return { customerId: row.customerId, sessionId };
}

export async function deleteCustomerSession(sessionId) {
  if (!sessionId) return false;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM customerSessions WHERE id = ?`, [sessionId]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Logout all sessions for a customer (e.g. after password change).
 */
export async function deleteAllCustomerSessions(customerId) {
  if (!customerId) return 0;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM customerSessions WHERE customerId = ?`, [customerId]);
  return res?.changes ?? 0;
}

/**
 * Cron: prune expired sessions.
 */
export async function pruneExpiredSessions() {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM customerSessions WHERE expiresAt < ?`, [nowIso()]);
  return res?.changes ?? 0;
}

/**
 * List active sessions for a customer (for "active devices" UI).
 */
export async function listCustomerSessions(customerId) {
  if (!customerId) return [];
  const db = await getAdapter();
  return db.all(
    `SELECT id, userAgent, ipAddress, createdAt, lastSeenAt, expiresAt
     FROM customerSessions WHERE customerId = ? ORDER BY lastSeenAt DESC`,
    [customerId]
  );
}
