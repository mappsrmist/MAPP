import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Database-backed brute-force protection (works across serverless instances, unlike in-memory counters).
 * Keys are scoped so one student cannot lock another student out:
 *   - per account + IP     : 5 failures  / 15 min  -> 15 min lock
 *   - per account (any IP) : 30 failures / 15 min  -> 15 min lock (stops distributed guessing)
 *   - per IP               : 300 failures / 15 min -> 15 min lock (campus NAT shares one IP, so this is generous)
 */
const WINDOW = 15 * 60;
const LOCK = 15 * 60;

export interface ThrottleKey {
  key: string;
  max: number;
}

export function loginKeys(role: string, username: string, ip: string): ThrottleKey[] {
  const user = `${role}:${username.trim().toLowerCase().slice(0, 100)}`;
  return [
    { key: `uip:${user}:${ip}`, max: 5 },
    { key: `u:${user}`, max: 30 },
    { key: `ip:${ip}`, max: 300 },
  ];
}

/** Best-effort client IP behind Vercel / a reverse proxy. */
export function clientIp(request: Request): string {
  const h = request.headers;
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  return ip.trim().slice(0, 64) || "unknown";
}

/** Seconds the caller must still wait (0 = allowed). Throws if the throttle store is unreachable (fail closed). */
export async function retryAfter(keys: ThrottleKey[]): Promise<number> {
  const admin = createAdminClient();
  const waits = await Promise.all(
    keys.map(async ({ key }) => {
      const { data, error } = await admin.rpc("throttle_blocked", { p_key: key });
      if (error) throw new Error("throttle unavailable");
      return Number(data) || 0;
    }),
  );
  return Math.max(...waits);
}

export async function recordFailure(keys: ThrottleKey[]): Promise<void> {
  const admin = createAdminClient();
  await Promise.all(
    keys.map(({ key, max }) => admin.rpc("throttle_fail", { p_key: key, p_max: max, p_window_secs: WINDOW, p_lock_secs: LOCK })),
  );
}

/** A successful sign-in clears only the per-account counters, never the IP one. */
export async function clearFailures(keys: ThrottleKey[]): Promise<void> {
  const admin = createAdminClient();
  await Promise.all(keys.filter((k) => !k.key.startsWith("ip:")).map(({ key }) => admin.rpc("throttle_clear", { p_key: key })));
}
