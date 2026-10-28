import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin } from "@/lib/server/origin";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordFailure, retryAfter, type ThrottleKey } from "@/lib/server/throttle";
import { changePasswordSchema } from "@/lib/validators";
import { PORTAL_HOME, type Role } from "@/lib/config";

export async function POST(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { currentPassword, newPassword } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Someone on a stolen session must not be able to brute-force the current password here.
  const keys: ThrottleKey[] = [{ key: `cp:${user.id}`, max: 5 }];
  try {
    if ((await retryAfter(keys)) > 0) {
      return NextResponse.json({ error: "Too many failed attempts. Try again in a few minutes." }, { status: 429 });
    }
  } catch {
    return NextResponse.json({ error: "Temporarily unavailable. Please try again shortly." }, { status: 503 });
  }

  const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
  if (profile && newPassword.toLowerCase().includes(profile.username.toLowerCase())) {
    return NextResponse.json({ error: "Your password must not contain your username." }, { status: 400 });
  }

  // Verify the current password with a throw-away client so the session cookies are untouched.
  const verifier = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyErr } = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (verifyErr) {
    await recordFailure(keys);
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updateErr) return NextResponse.json({ error: "Could not update the password. Choose a different one and try again." }, { status: 400 });

  await supabase.auth.signOut({ scope: "others" }); // old sessions (e.g. a stolen one) die with the old password

  // Clearing the flag needs the service role: clients cannot write profiles.
  const admin = createAdminClient();
  const { data: updated, error: flagErr } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id)
    .select("role")
    .single();
  if (flagErr) return NextResponse.json({ error: "Password changed, but the account could not be unlocked. Please sign in again." }, { status: 500 });

  return NextResponse.json({ ok: true, redirect: PORTAL_HOME[updated.role as Role] });
}
