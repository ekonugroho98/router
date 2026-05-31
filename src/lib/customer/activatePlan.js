// ADDON: saas-mt — Shared plan activation logic
// Called after payment completes or redeem code is used.
// Generates API key on first activation, sets quota, marks for provisioning.

import {
  getCustomerById,
  updateCustomer,
  listCustomerApiKeys,
  createCustomerApiKey,
} from "@/lib/db";

/**
 * Activate or extend a customer's plan.
 * On first activation: generates API key + marks provisionStatus = pending.
 *
 * @param {object} opts
 * @param {string} opts.customerId
 * @param {string} opts.plan - plan tier ('free', 'pro', etc.)
 * @param {number} opts.durationDays
 * @param {number} opts.quotaDailyLimit
 * @param {number} opts.quotaMonthlyLimit
 * @param {object} [opts.paymentInfo] - { orderId, amount, method }
 * @returns {{ customer, apiKey?, isFirstActivation }}
 */
export async function activatePlan({
  customerId,
  plan,
  durationDays,
  quotaDailyLimit,
  quotaMonthlyLimit,
  paymentInfo = null,
}) {
  const customer = await getCustomerById(customerId);
  if (!customer) throw new Error("Customer not found");

  const meta = typeof customer.metadata === "string"
    ? JSON.parse(customer.metadata || "{}")
    : (customer.metadata || {});

  // Calculate expiry — extend if current plan still active
  const currentExpiry = meta.expiresAt ? new Date(meta.expiresAt) : null;
  const baseDate = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
  const newExpiry = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  meta.expiresAt = newExpiry;
  meta.durationDays = durationDays;

  if (paymentInfo) {
    meta.lastPayment = {
      ...paymentInfo,
      completedAt: new Date().toISOString(),
    };
  }

  // Check if this is first activation (no API key yet)
  const existingKeys = await listCustomerApiKeys(customerId);
  const isFirstActivation = existingKeys.length === 0;
  let apiKey = null;

  if (isFirstActivation) {
    // First time — generate API key + mark for container provisioning
    apiKey = await createCustomerApiKey({ customerId, name: "default" });
    meta.provisionStatus = "pending";
  }

  await updateCustomer(customerId, {
    plan,
    quotaDailyLimit,
    quotaMonthlyLimit,
    isActive: 1,
    suspendedReason: null,
    metadata: meta,
  });

  const updated = await getCustomerById(customerId);

  // Notify admin
  notifyAdmin(customer.email, { plan, durationDays, isFirstActivation, paymentInfo }).catch(() => {});

  return { customer: updated, apiKey, isFirstActivation };
}

async function notifyAdmin(email, { plan, durationDays, isFirstActivation, paymentInfo }) {
  const token = process.env.ADMIN_TG_BOT_TOKEN || "";
  const chatId = process.env.ADMIN_TG_CHAT_ID || "";
  if (!token || !chatId) return;

  const lines = [
    `*Plan Activated${isFirstActivation ? " (BARU)" : ""}*`,
    ``,
    `Email: \`${email}\``,
    `Plan: *${plan}* (${durationDays} hari)`,
  ];
  if (paymentInfo?.orderId) {
    lines.push(`Order: \`${paymentInfo.orderId}\``);
    lines.push(`Amount: Rp ${(paymentInfo.amount || 0).toLocaleString("id-ID")}`);
  }
  if (isFirstActivation) {
    lines.push(``, `_API key generated, provisionStatus = pending_`);
  }

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: lines.join("\n"), parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
}
