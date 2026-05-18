// ADDON: saas-mt — Audit trail for admin actions on customers
import { getAdapter } from "../driver.js";

/**
 * Log an admin action on a customer.
 *
 * @param {object} opts
 * @param {string} opts.action - 'create' | 'update' | 'delete' | 'reset_password' | 'suspend' | 'unsuspend'
 * @param {string} opts.customerId
 * @param {string} opts.customerEmail - denormalized for post-delete lookups
 * @param {object} opts.changes - { field: { from, to } } or free-form data
 * @param {string} opts.adminIp
 */
export async function logAdminAction({ action, customerId, customerEmail, changes, adminIp } = {}) {
  const db = await getAdapter();
  db.run(
    `INSERT INTO customerAuditLog (timestamp, action, customerId, customerEmail, changes, adminIp)
     VALUES (datetime('now'), ?, ?, ?, ?, ?)`,
    [
      action,
      customerId || null,
      customerEmail || null,
      changes ? JSON.stringify(changes) : null,
      adminIp || null,
    ]
  );
}

/**
 * Get audit log for a customer (or all if customerId is null).
 */
export async function getAuditLog({ customerId, limit = 50, offset = 0 } = {}) {
  const db = await getAdapter();
  if (customerId) {
    return db.all(
      `SELECT * FROM customerAuditLog WHERE customerId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [customerId, limit, offset]
    );
  }
  return db.all(
    `SELECT * FROM customerAuditLog ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}
