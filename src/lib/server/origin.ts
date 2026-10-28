import "server-only";

/**
 * CSRF defence in depth for state-changing route handlers (cookies are SameSite=Lax already):
 * the Origin header, when present, must match the request URL's scheme, host and port. Browsers send Origin
 * on cross-site POSTs. If it is missing, the browser's Sec-Fetch-Site header must not say "cross-site".
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin" || site === "none"; // non-browser clients send neither
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export const MAX_BODY_BYTES = 512 * 1024;

export function bodyTooLarge(request: Request): boolean {
  return Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES;
}

/** Bound the actual stream before parsing; Content-Length can be absent or misleading. */
export async function readJsonBody(request: Request): Promise<unknown> {
  if (bodyTooLarge(request) || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
