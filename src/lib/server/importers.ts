import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_USERNAME, STUDENT_EMAIL_DOMAIN } from "@/lib/config";
import { dobToPassword } from "@/lib/auth-utils";
import type { FacultyImportRow, StudentRow } from "@/lib/validators";

type Admin = SupabaseClient;

/** Creates the auth user + profile for a username, or returns the existing profile id (idempotent). */
async function ensureUser(
  admin: Admin,
  opts: { role: "student" | "faculty" | "admin"; username: string; email: string; password: string },
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: lookupErr } = await admin
    .from("profiles")
    .select("id")
    .eq("username", opts.username)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "Could not create auth user");

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, role: opts.role, username: opts.username, must_change_password: true });
  if (profileErr) {
    await admin.auth.admin.deleteUser(data.user.id); // keep auth + profiles consistent
    throw new Error(profileErr.message);
  }
  return { id: data.user.id, created: true };
}

async function rollbackIfNew(admin: Admin, id: string, created: boolean) {
  if (created) await admin.auth.admin.deleteUser(id);
}

export async function upsertStudent(admin: Admin, row: StudentRow) {
  const { id, created } = await ensureUser(admin, {
    role: "student",
    username: row.reg_no,
    email: `${row.reg_no.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`,
    password: row.reg_no,
  });
  const { error } = await admin.from("students").upsert(
    { id, reg_no: row.reg_no, name: row.name, dept: row.dept, section: row.section, email: row.email },
    { onConflict: "id" },
  );
  if (error) {
    await rollbackIfNew(admin, id, created);
    throw new Error(error.message);
  }
  return created;
}

export async function upsertFaculty(admin: Admin, row: FacultyImportRow) {
  const { id, created } = await ensureUser(admin, {
    role: "faculty",
    username: row.srm_email,
    email: row.srm_email,
    password: dobToPassword(row.dob),
  });
  const { error } = await admin.from("faculty").upsert(
    {
      id,
      emp_id: row.emp_id,
      name: row.name,
      srm_email: row.srm_email,
      dob: row.dob,
      designation: row.designation,
      cadre: row.cadre,
      phone: row.phone,
      venue: row.venue,
      domains: row.domains,
    },
    { onConflict: "id" },
  );
  if (error) {
    await rollbackIfNew(admin, id, created);
    throw new Error(error.message);
  }
  return created;
}

export async function ensureAdmin(admin: Admin, password: string) {
  return ensureUser(admin, { role: "admin", username: ADMIN_USERNAME, email: ADMIN_EMAIL, password });
}
