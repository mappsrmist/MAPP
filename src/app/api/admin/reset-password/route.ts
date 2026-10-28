import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin, readJsonBody } from "@/lib/server/origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/guards";
import { generatePassword } from "@/lib/server/passwords";
import { resetPasswordSchema } from "@/lib/validators";

/** Replaces a user's password with a new random one-time password and forces a change at next login. */
export async function POST(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = resetPasswordSchema.safeParse(await readJsonBody(request));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("id, username").eq("id", body.data.profileId).maybeSingle();
  if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Flag first: if the password write below fails, the user is still forced to change it.
  const { error: flagErr } = await admin.from("profiles").update({ must_change_password: true }).eq("id", profile.id);
  if (flagErr) return NextResponse.json({ error: "Could not reset the password." }, { status: 500 });

  const password = generatePassword();
  const { error } = await admin.auth.admin.updateUserById(profile.id, { password });
  if (error) return NextResponse.json({ error: "Could not reset the password." }, { status: 500 });

  return NextResponse.json({ ok: true, username: profile.username, password });
}
