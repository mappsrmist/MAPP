import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STUDENT_EMAIL_DOMAIN } from "@/lib/config";
import { generatePassword } from "@/lib/server/passwords";
import type { FacultyImportRow, StudentRow } from "@/lib/validators";

type Admin = SupabaseClient;
type Role = "student" | "faculty";

export interface Upserted {
  created: boolean;
  /** One-time password; only present for newly created accounts. */
  password?: string;
}

/**
 * Creates the auth user + profile for a username with a random one-time password, or returns the
 * existing profile id (idempotent: existing accounts and their passwords are never touched).
 */
async function ensureUser(
  admin: Admin,
  opts: { role: Role; username: string; email: string },
): Promise<{ id: string; created: boolean; password?: string }> {
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

  const password = generatePassword();
  const { data, error } = await admin.auth.admin.createUser({ email: opts.email, password, email_confirm: true });
  if (error || !data.user) throw new Error("Could not create the account (is the email already in use?)");

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, role: opts.role, username: opts.username, must_change_password: true });
  if (profileErr) {
    await admin.auth.admin.deleteUser(data.user.id); // keep auth + profiles consistent
    throw new Error("Could not create the account");
  }
  return { id: data.user.id, created: true, password };
}

async function rollbackIfNew(admin: Admin, id: string, created: boolean) {
  if (created) await admin.auth.admin.deleteUser(id);
}

export async function upsertStudent(admin: Admin, row: StudentRow): Promise<Upserted> {
  const { id, created, password } = await ensureUser(admin, {
    role: "student",
    username: row.reg_no,
    email: `${row.reg_no.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`,
  });
  const { error } = await admin.from("students").upsert(
    { id, reg_no: row.reg_no, name: row.name, dept: row.dept, section: row.section, email: row.email },
    { onConflict: "id" },
  );
  if (error) {
    await rollbackIfNew(admin, id, created);
    throw new Error("Could not save the student (duplicate registration number?)");
  }
  return { created, password };
}

export async function upsertFaculty(admin: Admin, row: FacultyImportRow): Promise<Upserted> {
  const { id, created, password } = await ensureUser(admin, {
    role: "faculty",
    username: row.srm_email,
    email: row.srm_email,
  });
  const { error } = await admin.from("faculty").upsert(
    {
      id,
      emp_id: row.emp_id,
      name: row.name,
      srm_email: row.srm_email,
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
    throw new Error("Could not save the faculty member (duplicate employee ID or email?)");
  }
  return { created, password };
}
