// ADDON: saas-mt — Redemption codes for customer activation
import crypto from "crypto";
import { getAdapter } from "../driver.js";

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  const seg = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `CORTEX-${seg()}-${seg()}`;
}

/**
 * Generate one or more redemption codes.
 */
export async function createRedeemCodes({
  count = 1,
  plan = "free",
  durationDays = 3,
  quotaDailyLimit = 100,
  quotaMonthlyLimit = 3000,
  maxUses = 1,
  label = null,
  expiresAt = null,
} = {}) {
  const db = await getAdapter();
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = generateCode();
    db.run(
      `INSERT INTO redeemCodes (code, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxUses, isActive, label, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [code, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxUses, label, expiresAt]
    );
    codes.push({ code, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxUses, label });
  }
  return codes;
}

/**
 * Validate and consume a redemption code.
 * Returns the code data if valid, null if invalid/expired/used up.
 */
export async function redeemCode(code) {
  if (!code) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM redeemCodes WHERE code = ?`, [code.toUpperCase().trim()]);
  if (!row) return null;
  if (!row.isActive) return { error: "Code has been deactivated" };
  if (row.usedCount >= row.maxUses) return { error: "Code has been fully redeemed" };
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return { error: "Code has expired" };

  // Increment usage
  db.run(`UPDATE redeemCodes SET usedCount = usedCount + 1 WHERE id = ?`, [row.id]);

  return {
    valid: true,
    plan: row.plan,
    durationDays: row.durationDays,
    quotaDailyLimit: row.quotaDailyLimit,
    quotaMonthlyLimit: row.quotaMonthlyLimit,
  };
}

/**
 * List all codes (admin).
 */
export async function listRedeemCodes({ limit = 100, offset = 0 } = {}) {
  const db = await getAdapter();
  return db.all(
    `SELECT * FROM redeemCodes ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

/**
 * Deactivate a code.
 */
export async function deactivateRedeemCode(id) {
  const db = await getAdapter();
  db.run(`UPDATE redeemCodes SET isActive = 0 WHERE id = ?`, [id]);
}
