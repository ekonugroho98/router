// Pak Kasir payment gateway integration
// Docs: https://pakasir.com/p/docs

const PAKASIR_BASE = "https://app.pakasir.com";
const PAKASIR_SLUG = "cortex-ai";

function getApiKey() {
  return process.env.PAKASIR_API_KEY || "";
}

/**
 * Supported payment methods with display info.
 */
export const PAYMENT_METHODS = [
  { code: "qris", label: "QRIS", fee: "0.7%", type: "qris" },
  { code: "bni_va", label: "BNI Virtual Account", fee: "Rp 3.500", type: "va" },
  { code: "bri_va", label: "BRI Virtual Account", fee: "Rp 3.500", type: "va" },
  { code: "cimb_niaga_va", label: "CIMB Niaga VA", fee: "Rp 3.500", type: "va" },
  { code: "permata_va", label: "Permata VA", fee: "Rp 3.500", type: "va" },
  { code: "bni_va", label: "BNI VA", fee: "Rp 3.500", type: "va" },
];

/**
 * Plan definitions for purchase.
 */
export const PLANS = [
  {
    id: "daily",
    name: "Daily",
    price: 2000,
    durationDays: 1,
    quotaDailyLimit: 300,
    quotaMonthlyLimit: 9000,
    plan: "free",
    description: "1 hari akses, 300 req/hari",
  },
  {
    id: "weekly",
    name: "Weekly",
    price: 12000,
    durationDays: 7,
    quotaDailyLimit: 300,
    quotaMonthlyLimit: 9000,
    plan: "free",
    description: "7 hari akses, 300 req/hari",
  },
  {
    id: "premium",
    name: "Premium",
    price: 49000,
    originalPrice: 149000,
    durationDays: 30,
    quotaDailyLimit: 500,
    quotaMonthlyLimit: 15000,
    plan: "pro",
    description: "30 hari akses, 500 req/hari",
    popular: true,
  },
  {
    id: "ultra",
    name: "Ultra",
    price: 79000,
    durationDays: 30,
    quotaDailyLimit: 1000,
    quotaMonthlyLimit: 30000,
    plan: "ultra",
    description: "30 hari akses, 1000 req/hari",
  },
];

/**
 * Create a payment transaction via Pak Kasir.
 */
export async function createPayment({ orderId, amount, method, redirectUrl }) {
  const res = await fetch(`${PAKASIR_BASE}/api/transactioncreate/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project: PAKASIR_SLUG,
      order_id: orderId,
      amount,
      api_key: getApiKey(),
      redirect_url: redirectUrl || null,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pakasir error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Check payment status.
 */
export async function getPaymentStatus({ orderId, amount }) {
  const params = new URLSearchParams({
    project: PAKASIR_SLUG,
    order_id: orderId,
    amount: String(amount),
    api_key: getApiKey(),
  });
  const res = await fetch(`${PAKASIR_BASE}/api/transactiondetail?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pakasir status error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Cancel a payment.
 */
export async function cancelPayment({ orderId, amount }) {
  const res = await fetch(`${PAKASIR_BASE}/api/transactioncancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project: PAKASIR_SLUG,
      order_id: orderId,
      amount,
      api_key: getApiKey(),
    }),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}
