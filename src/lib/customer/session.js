// ADDON: saas-mt — Helper to extract authenticated customer from a Next.js request.
// Used by /api/customer/* protected routes + dashboard server components.

import { verifyCustomerSession, getCustomerById } from "@/lib/db";

export const SESSION_COOKIE = "cortex_session";

/**
 * Authenticate a customer from the request's session cookie.
 *
 * @param {Request} request - Next.js Request (with cookies()-like API)
 * @returns {Promise<object|null>} customer (without passwordHash) or null
 */
export async function getCustomerFromRequest(request) {
  // Next.js Route Handler: request.cookies.get(name)?.value
  // Next.js Page (cookies()): use getCustomerFromCookies(cookiesStore) instead
  const cookieValue = request?.cookies?.get?.(SESSION_COOKIE)?.value;
  if (!cookieValue) return null;
  return getCustomerFromCookieValue(cookieValue);
}

/**
 * For server components that use cookies() from next/headers.
 */
export async function getCustomerFromCookies(cookies) {
  const cookieValue = cookies?.get?.(SESSION_COOKIE)?.value;
  if (!cookieValue) return null;
  return getCustomerFromCookieValue(cookieValue);
}

async function getCustomerFromCookieValue(cookieValue) {
  const session = await verifyCustomerSession(cookieValue);
  if (!session?.customerId) return null;
  const customer = await getCustomerById(session.customerId);
  if (!customer || !customer.isActive) return null;
  return customer;
}
