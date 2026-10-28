"use client";

import * as React from "react";
import { Snowflake } from "lucide-react";
import { MSG } from "@/lib/config";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";

const FreezeCtx = React.createContext(false);

/** True while the admin's global freeze is on. Write buttons use it to disable themselves (the RPCs enforce it too). */
export const useGlobalFreeze = () => React.useContext(FreezeCtx);

export function FreezeBanner({ message = MSG.FROZEN }: { message?: string }) {
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <Snowflake className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <p>
        <strong>{message}.</strong> {MSG.FROZEN_HINT}
      </p>
    </div>
  );
}

/** Holds the global freeze flag, kept live through Realtime, and shows the banner on every portal page. */
export function FreezeProvider({ initial, children }: { initial: boolean; children: React.ReactNode }) {
  const [frozen, setFrozen] = React.useState(initial);

  const load = React.useCallback(async () => {
    const { data } = await createClient().from("system_settings").select("global_frozen").eq("id", 1).maybeSingle();
    if (data) setFrozen(data.global_frozen);
  }, []);
  useRealtime([{ table: "system_settings" }], () => void load());

  return (
    <FreezeCtx.Provider value={frozen}>
      {frozen && <FreezeBanner />}
      {children}
    </FreezeCtx.Provider>
  );
}
