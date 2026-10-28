import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin, readJsonBody } from "@/lib/server/origin";
import { clearFailures, clientIp, loginKeys, recordFailure, retryAfter } from "@/lib/server/throttle";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validators";
import { usernameToEmail } from "@/lib/auth-utils";
import { PORTAL_HOME, type Role } from "@/lib/config";

// One generic error for every failure mode so usernames cannot be enumerated.
const fail = () => NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

const locked = (seconds: number) =>
  NextResponse.json(
    { error: `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).` },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );

export async function POST(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = loginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { role, username, password } = parsed.data;

  const keys = loginKeys(role, username, clientIp(request));
  try {
    const wait = await retryAfter(keys);
    if (wait > 0) return locked(wait);
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }

  const email = usernameToEmail(role, username);
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", data.user.id)
    .maybeSingle();

  // The credentials may be valid but belong to a different role than the tab used.
  if (!profile || profile.role !== role) {
    await supabase.auth.signOut();
    await recordFailure(keys);
    return fail();
  }

  await clearFailures(keys);
  return NextResponse.json({
    role,
    mustChangePassword: profile.must_change_password,
    redirect: profile.must_change_password ? "/force-password" : PORTAL_HOME[role as Role],
  });
}
