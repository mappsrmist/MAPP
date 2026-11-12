import { safeApi } from "@/lib/server/safe-api";
import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin, readJsonBody } from "@/lib/server/origin";
import { clearFailures, clientIp, loginKeys, recordFailure, retryAfter } from "@/lib/server/throttle";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validators";
import { resolveLogin } from "@/lib/auth-utils";
import { PORTAL_HOME } from "@/lib/config";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { createGate } from "@/lib/server/gate";

// One generic error for every failure mode so usernames cannot be enumerated.
const fail = () => NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

const locked = (seconds: number) =>
  NextResponse.json(
    { error: `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).` },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );

async function handlePost(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = loginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { role: tab, username, password } = parsed.data;
  // The admin has no tab of their own: the admin username on the Faculty tab selects the admin account.
  const target = resolveLogin(tab, username);
  const role = target.role;

  const keys = loginKeys(role, username, clientIp(request));
  // The old shared per-IP success budget (one hot database row that every login on campus NAT had to
  // update in turn) is replaced by the admission gate below; per-account budgets and failure locks remain.
  const limited = await enforceRateLimit([
    { key: `login:${keys[1].key}`, limit: role === "admin" ? 10 : 30, window: 900 },
  ]);
  if (limited) return limited;
  try {
    const wait = await retryAfter(keys);
    if (wait > 0) return locked(wait);
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }

  const email = target.email;
  if (!email) {
    await recordFailure(keys);
    return fail();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.status === 429) {
      return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
    }
    await recordFailure(keys);
    return fail();
  }

  // profile and (for students) the active flag are independent reads: fetch them together
  const [{ data: profile }, studentRes] = await Promise.all([
    supabase.from("profiles").select("role, must_change_password").eq("id", data.user.id).maybeSingle(),
    role === "student"
      ? supabase.from("students").select("is_active").eq("id", data.user.id).maybeSingle()
      : Promise.resolve(null),
  ]);

  // The credentials may be valid but belong to a different role than the tab used.
  if (!profile || profile.role !== role) {
    await supabase.auth.signOut();
    await recordFailure(keys);
    return fail();
  }

  // A removed student is refused exactly like a wrong password (their auth login is banned as well).
  if (role === "student" && !studentRes?.data?.is_active) {
    await supabase.auth.signOut();
    await recordFailure(keys);
    return fail();
  }

  await clearFailures(keys);
  return NextResponse.json({
    role,
    mustChangePassword: profile.must_change_password,
    redirect: profile.must_change_password ? "/force-password" : PORTAL_HOME[role],
  });
}

// Login queue: only a few sign-ins touch Auth/database at once per server instance; the rest wait in
// line for up to 12 s, then get a "busy" answer that the login page retries automatically.
const loginGate = createGate(6, 12_000, 400);

export const POST = safeApi(async (request) => {
  const res = await loginGate.run(() => handlePost(request));
  return (
    res ??
    NextResponse.json(
      { error: "The portal is very busy. You are in the queue and will be signed in automatically.", busy: true },
      { status: 503, headers: { "Retry-After": "4" } },
    )
  );
});
