import { safeApi } from "@/lib/server/safe-api";
import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin, readJsonBody } from "@/lib/server/origin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/guards";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { studentActionSchema } from "@/lib/validators";

// "Banned" for ~100 years; Supabase Auth refuses sign-in and token refresh for a banned user.
const BAN = "876000h";

/**
 * Removes (soft delete) or restores students. The database change is made through the admin-only RPC with the
 * caller's own session (so it is audited as them); the Auth login is then banned / unbanned with the service role.
 * Even if the ban call failed, the database already refuses the student: app_role() and every RPC check is_active.
 */
async function handlePost(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limited = await enforceRateLimit([{ key: `students:${user.id}`, limit: 30, window: 60 }]);
  if (limited) return limited;

  const body = studentActionSchema.safeParse(await readJsonBody(request));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, ids } = body.data;

  // The RPC ignores IDs outside students, whereas Auth's admin API accepts any account.
  // Verify the entire selection before either write so a mixed request cannot ban/unban faculty or admins.
  const admin = createAdminClient();
  const selectedIds = [...new Set(ids)];
  const { data: students, error: lookupError } = await admin.from("students").select("id").in("id", selectedIds);
  if (lookupError || !students) return NextResponse.json({ error: "Could not verify the selected students. Please try again." }, { status: 503 });
  const studentIds = new Set(students.map((student) => student.id as string));
  if (selectedIds.some((id) => !studentIds.has(id))) {
    return NextResponse.json({ error: "Only student accounts can be removed or restored here." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(action === "remove" ? "admin_remove_students" : "admin_restore_students", { p_ids: ids });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const results = await Promise.all(
    selectedIds.map((id) => admin.auth.admin.updateUserById(id, { ban_duration: action === "remove" ? BAN : "none" })),
  );
  const loginFailures = results.filter((r) => r.error).length;
  return NextResponse.json({ count: data as number, loginFailures });
}

export const POST = safeApi(handlePost);
