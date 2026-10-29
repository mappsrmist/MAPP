/**
 * Creates the demo accounts through the app's own importers (initial password = reg no / emp ID, forced change at
 * first login), then puts the data in the state the recordings start from by calling the real RPCs as each user.
 * Usage: npm run seed   (run `npm run reset` to start over)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertAdvisor, upsertFaculty, upsertStudent } from "@/lib/server/importers";
import { advisorRowSchema, facultyRowSchema, studentRowSchema } from "@/lib/validators";
import { ADVISOR, ALL_FACULTY, ALL_STUDENTS, DEMO_PASSWORD, DEPT, EXTRAS, EXTRA_MOOC_CGPA, GUIDE2, PARTNER_B, SECTION, STUDENT_A, studentEmail } from "./demo-data";
import { adminClient, isMain, must, signInAs } from "./supabase";
import { preflight } from "./preflight";

export async function facultyId(admin: SupabaseClient, empId: string): Promise<string> {
  const row = await must("faculty lookup", admin.from("faculty").select("id").eq("emp_id", empId).single());
  return (row as { id: string }).id;
}

async function profileId(admin: SupabaseClient, username: string): Promise<string> {
  const row = await must("profile lookup", admin.from("profiles").select("id").eq("username", username).single());
  return (row as { id: string }).id;
}

/** Accounts not shown logging in for the first time get their password set up front. */
async function skipFirstLogin(admin: SupabaseClient, username: string) {
  const id = await profileId(admin, username);
  const { error } = await admin.auth.admin.updateUserById(id, { password: DEMO_PASSWORD });
  if (error) throw new Error(`password for ${username}: ${error.message}`);
  await must(`flag for ${username}`, admin.from("profiles").update({ must_change_password: false }).eq("id", id));
}

/** `advisorFirstLogin`: keep the advisor on the initial password (the faculty video shows that first login). */
export async function seed({ advisorFirstLogin = true } = {}) {
  const admin = adminClient();
  await preflight(admin);

  for (const f of ALL_FACULTY) await upsertFaculty(admin, facultyRowSchema.parse(f));
  for (const s of ALL_STUDENTS) {
    await upsertStudent(admin, studentRowSchema.parse({ reg_no: s.reg_no, name: s.name, dept: DEPT, section: SECTION, email: s.email }));
  }
  await upsertAdvisor(admin, advisorRowSchema.parse({ emp_id: ADVISOR.emp_id, section: SECTION }));

  for (const f of ALL_FACULTY) if (f !== ADVISOR || !advisorFirstLogin) await skipFirstLogin(admin, f.srm_email);
  for (const s of ALL_STUDENTS) if (s !== STUDENT_A) await skipFirstLogin(admin, s.reg_no);

  const advisorId = await facultyId(admin, ADVISOR.emp_id);
  const guide2Id = await facultyId(admin, GUIDE2.emp_id);
  const minorExtras = EXTRAS.slice(0, 4);
  for (const s of minorExtras) {
    const c = await signInAs(studentEmail(s.reg_no), DEMO_PASSWORD);
    await must(`${s.name} request`, c.rpc("submit_request", { p_faculty_id: advisorId }));
  }
  const moocExtra = EXTRAS[4];
  await must(`${moocExtra.name} MOOC`, (await signInAs(studentEmail(moocExtra.reg_no), DEMO_PASSWORD)).rpc("opt_mooc", { p_cgpa: EXTRA_MOOC_CGPA }));
  await must("partner request", (await signInAs(studentEmail(PARTNER_B.reg_no), DEMO_PASSWORD)).rpc("submit_request", { p_faculty_id: guide2Id }));
  console.log(`seeded: ${ALL_STUDENTS.length} students, ${ALL_FACULTY.length} faculty, section ${SECTION}`);
}

if (isMain(import.meta.url)) {
  seed().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
