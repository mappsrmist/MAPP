import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin } from "@/lib/server/origin";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validators";
import { usernameToEmail } from "@/lib/auth-utils";
import { PORTAL_HOME, type Role } from "@/lib/config";
import { isMock, MOCK_COOKIE } from "@/lib/mock/client";
import { db } from "@/lib/mock/store";

// Brute-force protection: Supabase Auth rate-limits sign-ins per IP (Dashboard -> Auth -> Rate Limits).
// We also return one generic error for every failure mode so usernames cannot be enumerated.
const FAIL = NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

export async function POST(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { role, username, password } = parsed.data;

  const email = usernameToEmail(role, username);
  if (!email) return FAIL.clone();

  if (isMock()) {
    // DEV-ONLY: check the in-memory test accounts instead of Supabase Auth
    const cred = db().creds.get(email);
    const profile = cred && db().profiles.find((x) => x.id === cred.id);
    if (!cred || cred.password !== password || !profile || profile.role !== role) return FAIL.clone();
    const res = NextResponse.json({ role, mustChangePassword: false, redirect: PORTAL_HOME[role as Role] });
    res.cookies.set(MOCK_COOKIE, `${role}.${cred.id}`, { httpOnly: true, sameSite: "lax", path: "/" });
    return res;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.status === 429) {
      return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
    }
    return FAIL.clone();
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", data.user.id)
    .maybeSingle();

  // The credentials may be valid but belong to a different role than the tab used.
  if (!profile || profile.role !== role) {
    await supabase.auth.signOut();
    return FAIL.clone();
  }

  return NextResponse.json({
    role,
    mustChangePassword: profile.must_change_password,
    redirect: profile.must_change_password ? "/force-password" : PORTAL_HOME[role as Role],
  });
}
