/** Deletes the demo accounts (cascades to their requests, batches, applications and the C1 advisor mapping). */
import { ALL_FACULTY, ALL_STUDENTS, isDemoUsername } from "./demo-data";
import { adminClient, isMain } from "./supabase";

export async function cleanup() {
  const admin = adminClient();
  const usernames = [...ALL_STUDENTS.map((s) => s.reg_no), ...ALL_FACULTY.map((f) => f.srm_email)];
  const { data, error } = await admin.from("profiles").select("id, username").in("username", usernames);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const p of data ?? []) {
    if (!isDemoUsername(p.username)) continue; // belt and braces: never touch anything else
    const { error: delErr } = await admin.auth.admin.deleteUser(p.id);
    if (delErr) throw new Error(`delete ${p.username}: ${delErr.message}`);
    n++;
  }
  console.log(`cleanup: removed ${n} demo accounts`);
}

if (isMain(import.meta.url)) {
  cleanup().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
