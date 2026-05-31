// Portal-aware link helper
// On portal domain (cortex-ai.my.id), use short paths (/login, /dashboard, /pricing)
// On admin domain (9router.cortex-ai.my.id), use /customer/* paths

const PORTAL_DOMAINS = ["cortex-ai.my.id", "www.cortex-ai.my.id"];

export function isPortalDomain() {
  if (typeof window === "undefined") return false;
  return PORTAL_DOMAINS.includes(window.location.hostname);
}

export function portalLink(path) {
  if (!isPortalDomain()) return path;
  // Map /customer/* to portal short paths
  const map = {
    "/customer/login": "/login",
    "/customer/signup": "/register",
    "/customer/dashboard": "/dashboard",
    "/customer/pricing": "/pricing",
    "/customer/orders": "/orders",
    "/customer/verify-email": "/verify-email",
  };
  // Exact match
  if (map[path]) return map[path];
  // Prefix match for /customer/checkout/*
  if (path.startsWith("/customer/checkout/")) {
    return path.replace("/customer/checkout/", "/checkout/");
  }
  return path;
}
