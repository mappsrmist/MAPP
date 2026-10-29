import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fileURLToPath, pathToFileURL } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is missing from .env`);
  return v;
};
const opts = { auth: { autoRefreshToken: false, persistSession: false } };

export const adminClient = (): SupabaseClient => createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), opts);

/** A client signed in as a demo user, so RPCs run with that user's role checks. */
export async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), opts);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in as ${email} failed: ${error.message}`);
  return c;
}

/** Throws with the RPC's message so a failed setup step is obvious. */
export async function must<T>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

/** True when this module is the script being run (not imported). */
export const isMain = (moduleUrl: string) => !!process.argv[1] && pathToFileURL(process.argv[1]).href === moduleUrl;
