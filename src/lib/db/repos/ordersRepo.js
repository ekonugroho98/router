// ADDON: saas-mt — Payment orders for Pak Kasir integration
import crypto from "crypto";
import { getAdapter } from "../driver.js";

function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `CTX-${ts}-${rand}`;
}

/**
 * Create a new order.
 */
export async function createOrder({
  customerId,
  planId,
  planName,
  amount,
  paymentMethod,
  durationDays,
  quotaDailyLimit,
  quotaMonthlyLimit,
  plan, // plan tier: 'free', 'pro', etc.
}) {
  const db = await getAdapter();
  const orderId = generateOrderId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO orders (orderId, customerId, planId, planName, amount, paymentMethod, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [orderId, customerId, planId, planName, amount, paymentMethod, plan, durationDays, quotaDailyLimit, quotaMonthlyLimit, now, now]
  );

  return {
    orderId,
    customerId,
    planId,
    planName,
    amount,
    paymentMethod,
    plan,
    durationDays,
    quotaDailyLimit,
    quotaMonthlyLimit,
    status: "pending",
    createdAt: now,
  };
}

/**
 * Get order by orderId.
 */
export async function getOrderById(orderId) {
  const db = await getAdapter();
  return db.get(`SELECT * FROM orders WHERE orderId = ?`, [orderId]);
}

/**
 * Update order with payment gateway response.
 */
export async function updateOrderPayment(orderId, {
  paymentNumber,
  paymentUrl,
  expiredAt,
  fee,
  totalPayment,
}) {
  const db = await getAdapter();
  db.run(
    `UPDATE orders SET paymentNumber = ?, paymentUrl = ?, expiredAt = ?, fee = ?, totalPayment = ?, updatedAt = ? WHERE orderId = ?`,
    [paymentNumber || null, paymentUrl || null, expiredAt || null, fee || 0, totalPayment || 0, new Date().toISOString(), orderId]
  );
}

/**
 * Update order status.
 */
export async function updateOrderStatus(orderId, status, completedAt = null) {
  const db = await getAdapter();
  db.run(
    `UPDATE orders SET status = ?, completedAt = ?, updatedAt = ? WHERE orderId = ?`,
    [status, completedAt, new Date().toISOString(), orderId]
  );
}

/**
 * List orders for a customer.
 */
export async function listCustomerOrders(customerId, { limit = 20, offset = 0 } = {}) {
  const db = await getAdapter();
  return db.all(
    `SELECT * FROM orders WHERE customerId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [customerId, limit, offset]
  );
}

/**
 * Get pending order for customer (to prevent duplicate orders).
 */
export async function getPendingOrder(customerId) {
  const db = await getAdapter();
  return db.get(
    `SELECT * FROM orders WHERE customerId = ? AND status = 'pending' ORDER BY createdAt DESC LIMIT 1`,
    [customerId]
  );
}

/**
 * List all orders (admin).
 */
export async function listAllOrders({ limit = 50, offset = 0, status } = {}) {
  const db = await getAdapter();
  if (status) {
    return db.all(
      `SELECT o.*, c.email as customerEmail FROM orders o LEFT JOIN customers c ON o.customerId = c.id WHERE o.status = ? ORDER BY o.createdAt DESC LIMIT ? OFFSET ?`,
      [status, limit, offset]
    );
  }
  return db.all(
    `SELECT o.*, c.email as customerEmail FROM orders o LEFT JOIN customers c ON o.customerId = c.id ORDER BY o.createdAt DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}
