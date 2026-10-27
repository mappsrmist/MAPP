import "server-only";

/**
 * CSRF defence in depth for state-changing route handlers (cookies are SameSite=Lax already):
 * the Origin header, when present, must match the host being served. Browsers always send Origin
 * on cross-site POSTs, so a forged cross-site request is rejected.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin navigations / non-browser clients carry no Origin
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const MAX_BODY_BYTES = 512 * 1024;

export function bodyTooLarge(request: Request): boolean {
  return Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES;
}
