import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PORTAL_HOME, type Role } from "@/lib/config";

/**
 * Server-side guard used by every portal layout (second line of defence after the proxy).
 * Redirects unauthenticated users to /login, users who must change their password to
 * /force-password, and users of another role to their own portal.
 */
export async function requireRole(role: Role) {
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
}
