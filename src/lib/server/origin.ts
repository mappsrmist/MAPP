import "server-only";

/**
 * CSRF defence in depth for state-changing route handlers (cookies are SameSite=Lax already):
 * the Origin header, when present, must match the host being served. Browsers always send Origin
 * on cross-site POSTs. If it is missing, the browser's Sec-Fetch-Site header must not say "cross-site".
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin" || site === "none"; // non-browser clients send neither
  }
  try {
    const rawHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!rawHost) return false;
    // Proxies like Vercel or Cloudflare may send comma-separated hosts or include standard ports
    const host = rawHost.split(",")[0].trim().toLowerCase().replace(/:(80|443)$/, "");
    const originHost = new URL(origin).host.toLowerCase().replace(/:(80|443)$/, "");
    return originHost === host;
  } catch {
    return false;
  }
}

export const MAX_BODY_BYTES = 512 * 1024;

export function bodyTooLarge(request: Request): boolean {
  return Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES;
}
