import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin } from "@/lib/server/origin";
import { isMock } from "@/lib/mock/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminInitialPassword, requireAdmin } from "@/lib/server/guards";
import { resetPasswordSchema } from "@/lib/validators";
import { dobToPassword } from "@/lib/auth-utils";

/** Resets a user's password to their initial default and forces a change on next login. */
export async function POST(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (isMock()) return NextResponse.json({ error: "Not available in mock mode (no database connected)." }, { status: 501 });

  const body = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, username")
    .eq("id", body.data.profileId)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let password: string;
  if (profile.role === "student") {
    password = profile.username; // reg no
  } else if (profile.role === "faculty") {
    const { data: f } = await admin.from("faculty").select("dob").eq("id", profile.id).single();
    if (!f?.dob) return NextResponse.json({ error: "Faculty has no date of birth on file" }, { status: 400 });
    password = dobToPassword(f.dob);
  } else {
    password = adminInitialPassword();
  }

  const { error } = await admin.auth.admin.updateUserById(profile.id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("profiles").update({ must_change_password: true }).eq("id", profile.id);

  return NextResponse.json({ ok: true });
}
