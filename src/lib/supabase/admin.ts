import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client. Server code ONLY (route handlers). Bypasses RLS. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
