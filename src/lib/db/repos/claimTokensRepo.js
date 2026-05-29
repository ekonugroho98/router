// ADDON: saas-mt — One-time claim tokens for Lynk.id integration
import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { createRedeemCodes } from "./redeemCodesRepo.js";

function generateToken() {
  return crypto.randomBytes(16).toString("base64url"); // 22 chars, URL-safe
}

/**
 * Generate batch of claim tokens.
 */
export async function createClaimTokens({
  count = 1,
  plan = "free",
  durationDays = 3,
  quotaDailyLimit = 300,
  quotaMonthlyLimit = 9000,
  maxClaims = 1,
  label = null,
  expiresAt = null,
} = {}) {
  const db = await getAdapter();
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const token = generateToken();
    db.run(
      `INSERT INTO claimTokens (token, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxClaims, isActive, label, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [token, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxClaims, label, expiresAt]
    );
    tokens.push({ token, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, maxClaims, label });
  }
  return tokens;
}

/**
 * Claim a token: validate, generate redeem code, increment counter.
 * Returns { code, plan, ... } on success, { error } on failure.
 */
export async function claimToken(token) {
  if (!token) return { error: "Token required" };
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM claimTokens WHERE token = ?`, [token]);
  if (!row) return { error: "Invalid token" };
  if (!row.isActive) return { error: "Token deactivated" };
  if (row.claimedCount >= row.maxClaims) return { error: "Token already used" };
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return { error: "Token expired" };

  // Generate a redeem code
  const [code] = await createRedeemCodes({
    count: 1,
    plan: row.plan,
    durationDays: row.durationDays,
    quotaDailyLimit: row.quotaDailyLimit,
    quotaMonthlyLimit: row.quotaMonthlyLimit,
    maxUses: 1,
    label: `claim:${token.slice(0, 8)}`,
  });

  // Increment claim count
  db.run(`UPDATE claimTokens SET claimedCount = claimedCount + 1 WHERE id = ?`, [row.id]);

  return {
    success: true,
    code: code.code,
    plan: row.plan,
    durationDays: row.durationDays,
  };
}

/**
 * List all claim tokens (admin).
 */
export async function listClaimTokens({ limit = 100, offset = 0 } = {}) {
  const db = await getAdapter();
  return db.all(
    `SELECT * FROM claimTokens ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

/**
 * Deactivate a claim token.
 */
export async function deactivateClaimToken(id) {
  const db = await getAdapter();
  db.run(`UPDATE claimTokens SET isActive = 0 WHERE id = ?`, [id]);
}

/**
 * Delete a claim token permanently.
 */
export async function deleteClaimToken(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM claimTokens WHERE id = ?`, [id]);
}
