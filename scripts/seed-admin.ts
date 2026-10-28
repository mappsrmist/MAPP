/**
 * Creates (or leaves untouched) the admin account.
 *   username: mappCtech   |   initial password: ADMIN_INITIAL_PASSWORD from the environment
 * Usage: npm run seed:admin
 * Idempotent. The admin must change this password on first login; remove ADMIN_INITIAL_PASSWORD from the
 * environment afterwards (nothing else reads it).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_USERNAME } from "../src/lib/config";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!password || password.length < 12) throw new Error("ADMIN_INITIAL_PASSWORD is required (min 12 characters)");

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: existing, error: lookupErr } = await admin.from("profiles").select("id").eq("username", ADMIN_USERNAME).maybeSingle();
  if (lookupErr) throw lookupErr;
  if (existing) {
    console.log("Admin already exists - nothing to do. (Use the admin portal to reset its password.)");
    return;
  }

  const { data, error } = await admin.auth.admin.createUser({ email: ADMIN_EMAIL, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, role: "admin", username: ADMIN_USERNAME, must_change_password: true });
  if (profileErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw profileErr;
  }
  console.log(`Admin created. Sign in as "${ADMIN_USERNAME}" with the password from ADMIN_INITIAL_PASSWORD.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
