// ADDON: saas-mt — In-memory sliding window rate limiter
//
// Usage:
//   import { rateLimit } from "@/lib/customer/rateLimit";
//   const limiter = rateLimit({ windowMs: 60_000, max: 5 });
//   // In route handler:
//   const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
//   const rl = limiter.check(ip);
//   if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

const stores = new Map(); // key → { hits: [{ts}], timer }

/**
 * Create a rate limiter instance.
 *
 * @param {object} opts
 * @param {number} opts.windowMs  - sliding window in ms (default 60s)
 * @param {number} opts.max       - max requests per window (default 5)
 * @param {string} opts.message   - error message on limit (optional)
 * @returns {{ check(key: string): { ok: boolean, remaining: number, message?: string } }}
 */
export function rateLimit({ windowMs = 60_000, max = 5, message } = {}) {
  const id = Symbol();
  stores.set(id, new Map());

  // Periodic cleanup every 5 minutes — drop expired entries
  const cleanup = setInterval(() => {
    const store = stores.get(id);
    if (!store) return;
    const now = Date.now();
    for (const [key, hits] of store) {
      const valid = hits.filter((t) => now - t < windowMs);
      if (valid.length === 0) store.delete(key);
      else store.set(key, valid);
    }
  }, 5 * 60_000);
  if (cleanup.unref) cleanup.unref(); // don't keep process alive

  return {
    check(key) {
      const store = stores.get(id);
      const now = Date.now();
      const hits = (store.get(key) || []).filter((t) => now - t < windowMs);
      hits.push(now);
      store.set(key, hits);

      if (hits.length > max) {
        const retryAfterMs = windowMs - (now - hits[0]);
        return {
          ok: false,
          remaining: 0,
          retryAfter: Math.ceil(retryAfterMs / 1000),
          message:
            message ||
            `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
        };
      }
      return { ok: true, remaining: max - hits.length };
    },
  };
}

/** Extract client IP from request (works behind reverse proxy). */
export function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
