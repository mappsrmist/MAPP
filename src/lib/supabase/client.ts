import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMock, mockBrowserClient } from "@/lib/mock/client";

export function createClient(): SupabaseClient {
  if (isMock()) return mockBrowserClient() as unknown as SupabaseClient; // dev-only fake backend
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
