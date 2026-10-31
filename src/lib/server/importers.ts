import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STUDENT_EMAIL_DOMAIN } from "@/lib/config";
import type { FacultyImportRow, StudentRow } from "@/lib/validators";

type Admin = SupabaseClient;
type Role = "student" | "faculty";

export interface Upserted {
  created: boolean;
  /** The student was saved but the Faculty Advisor could not be linked; reported against the row. */
  warning?: string;
}

/**
 * Creates the auth user + profile for a username, or returns the existing profile id (idempotent:
 * existing accounts and their passwords are never touched). The initial password is the registration
 * number (students) or employee ID (faculty); `must_change_password` forces a new one at first login.
 */
async function ensureUser(
  admin: Admin,
  opts: { role: Role; username: string; email: string; initialPassword: string },
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: lookupErr } = await admin
    .from("profiles")
    .select("id, role")
    .eq("username", opts.username)
    .maybeSingle();
  if (lookupErr) throw new Error("Could not look up the account");
  if (existing) {
    // A username that already belongs to another role must never be re-purposed by an import.
    if (existing.role !== opts.role) throw new Error(`"${opts.username}" is already registered as ${existing.role}`);
    return { id: existing.id, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({ email: opts.email, password: opts.initialPassword, email_confirm: true });
  if (error || !data.user) throw new Error("Could not create the account (is the email already in use?)");

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, role: opts.role, username: opts.username, must_change_password: true });
  if (profileErr) {
    await admin.auth.admin.deleteUser(data.user.id); // keep auth + profiles consistent
    throw new Error("Could not create the account");
  }
  return { id: data.user.id, created: true };
}

async function rollbackIfNew(admin: Admin, id: string, created: boolean) {
  if (created) await admin.auth.admin.deleteUser(id);
}

/** Faculty Advisor of a student: the faculty member whose SRM email equals the row's FA Email. */
async function findAdvisor(admin: Admin, email: string): Promise<string | null> {
  const { data, error } = await admin.from("faculty").select("id").eq("srm_email", email).maybeSingle();
  if (error) throw new Error("Could not look up the Faculty Advisor");
  return data?.id ?? null;
}

export async function upsertStudent(admin: Admin, row: StudentRow): Promise<Upserted> {
  // a blank FA Email leaves the existing advisor alone; an unknown one never blocks the student itself
  const advisorId = row.fa_email ? await findAdvisor(admin, row.fa_email) : null;
  const { id, created } = await ensureUser(admin, {
    role: "student",
    username: row.reg_no,
    initialPassword: row.reg_no,
    email: `${row.reg_no.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`,
  });
  const { error } = await admin.from("students").upsert(
    { id, reg_no: row.reg_no, name: row.name, dept: row.dept, section: row.section, email: row.email, ...(advisorId ? { fa_id: advisorId } : {}) },
    { onConflict: "id" },
  );
  if (error) {
    await rollbackIfNew(admin, id, created);
    throw new Error("Could not save the student (duplicate registration number?)");
  }
  const warning = row.fa_email && !advisorId
    ? `Faculty Advisor "${row.fa_email}" not found. The student was saved without an advisor; import the faculty first, then upload this row again.`
    : undefined;
  return { created, warning };
}

export async function upsertFaculty(admin: Admin, row: FacultyImportRow): Promise<Upserted> {
  const { id, created } = await ensureUser(admin, {
    role: "faculty",
    username: row.srm_email,
    initialPassword: row.emp_id,
    email: row.srm_email,
  });
  const { error } = await admin.from("faculty").upsert(
    {
      id,
      emp_id: row.emp_id,
      name: row.name,
      srm_email: row.srm_email,
      cadre: row.cadre,
      phone: row.phone,
      venue: row.venue,
      domains: row.domains,
    },
    { onConflict: "id" },
  );
  if (error) {
    await rollbackIfNew(admin, id, created);
    throw new Error("Could not save the faculty member (duplicate employee ID or email?)");
  }
  return { created };
}
