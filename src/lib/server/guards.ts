import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Verifies (server-side, from the session cookie) that the caller is an admin who has set their own password. */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || profile.must_change_password) return null;
  return user;
}

/** Initial password for admin comes from the environment, never from the repo. */
export function adminInitialPassword(): string {
  const pw = process.env.ADMIN_INITIAL_PASSWORD;
  if (!pw || pw.length < 8) throw new Error("ADMIN_INITIAL_PASSWORD must be set (min 8 chars)");
  return pw;
}
