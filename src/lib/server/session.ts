import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PORTAL_HOME, type Role } from "@/lib/config";

/**
 * Server-side guard used by every portal layout (second line of defence after the proxy).
 * Redirects unauthenticated users to /login, users who must change their password to
 * /force-password, and users of another role to their own portal.
 */
// React cache is scoped to one server render, never shared between users or requests.
export const requireRole = cache(async (role: Role) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/login");
  if (profile.must_change_password) redirect("/force-password");
  if (profile.role !== role) redirect(PORTAL_HOME[profile.role as Role]);

  return { supabase, user };
});

/** Shared by the student layout and page during the same render. RLS still applies. */
export const getStudent = cache(async () => {
  const { supabase, user } = await requireRole("student");
  const { data: student, error } = await supabase
    .from("students")
    .select("name, reg_no, choice, is_active")
    .eq("id", user.id)
    .single();
  if (error) throw new Error("Could not load student details. Please try again.");
  // a removed student has no portal (their login is disabled too)
  if (!student || !student.is_active) redirect("/login");
  return { student, user };
});

/** The admin's global freeze flag, for the banner and for disabling write buttons on first paint. */
export const getGlobalFrozen = cache(async (role: Role) => {
  const { supabase } = await requireRole(role);
  const { data } = await supabase.from("system_settings").select("global_frozen").eq("id", 1).maybeSingle();
  return data?.global_frozen ?? false;
});
