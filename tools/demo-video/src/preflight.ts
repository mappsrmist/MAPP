import type { SupabaseClient } from "@supabase/supabase-js";
import { ADVISOR, SECTION } from "./demo-data";

/** Refuses to seed when it would interfere with the real portal: frozen allocations or a section owned by someone else. */
export async function preflight(admin: SupabaseClient): Promise<void> {
  const { data: settings, error } = await admin.from("system_settings").select("global_frozen").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Could not read system_settings: ${error.message}`);
  if (settings?.global_frozen) throw new Error("Portal is frozen by the admin. Unfreeze it in the admin portal before recording (this tool never changes it).");

  const { data: fa, error: faErr } = await admin.from("faculty_advisors").select("faculty(emp_id)").eq("section", SECTION).maybeSingle();
  if (faErr) throw new Error(`Could not read faculty_advisors: ${faErr.message}`);
  const owner = (fa as { faculty: { emp_id: string } | null } | null)?.faculty?.emp_id;
  if (owner && owner.toLowerCase() !== ADVISOR.emp_id.toLowerCase()) {
    throw new Error(`Section ${SECTION} already has advisor ${owner}. Pick another demo section in demo-data.ts.`);
  }
}
