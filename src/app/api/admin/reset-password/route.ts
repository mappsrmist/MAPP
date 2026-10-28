import { safeApi } from "@/lib/server/safe-api";
import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin, readJsonBody } from "@/lib/server/origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/guards";
import { resetPasswordSchema } from "@/lib/validators";
import { enforceRateLimit } from "@/lib/server/rate-limit";

/**
 * Resets a student / faculty password back to the initial one (registration number / employee ID)
 * and forces a change at next login.
 */
async function handlePost(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limited = await enforceRateLimit([{ key: `reset:${user.id}`, limit: 20, window: 60 }]);
  if (limited) return limited;

  const body = resetPasswordSchema.safeParse(await readJsonBody(request));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("id, role, username").eq("id", body.data.profileId).maybeSingle();
  if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let initial: string | undefined;
  if (profile.role === "student") {
    initial = (await admin.from("students").select("reg_no").eq("id", profile.id).maybeSingle()).data?.reg_no;
  } else if (profile.role === "faculty") {
    initial = (await admin.from("faculty").select("emp_id").eq("id", profile.id).maybeSingle()).data?.emp_id;
  }
  if (!initial) return NextResponse.json({ error: "Only student and faculty passwords can be reset here." }, { status: 400 });

  // Flag first: if the password write below fails, the user is still forced to change it.
  const { error: flagErr } = await admin.from("profiles").update({ must_change_password: true }).eq("id", profile.id);
  if (flagErr) return NextResponse.json({ error: "Could not reset the password." }, { status: 500 });

  const { error } = await admin.auth.admin.updateUserById(profile.id, { password: initial });
  if (error) return NextResponse.json({ error: "Could not reset the password." }, { status: 500 });

  return NextResponse.json({ ok: true, username: profile.username, role: profile.role });
}

export const POST = safeApi(handlePost);
