"use client";

import * as React from "react";
import { Armchair, Layers, UserCheck, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FreezeBanner, useGlobalFreeze } from "@/components/freeze";
import { CADRE_LABEL, FACULTY_COLS, MSG, batchesForCadre } from "@/lib/config";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { FacultyRow } from "@/lib/types";

interface Ctx {
  faculty: FacultyRow;
  /** increments on every realtime change to requests / batches / the faculty row; pages use it to refetch */
  tick: number;
  bump: () => void;
  /** true when the admin froze everything or just this faculty: accept / decline / group / ungroup / edit are locked */
  frozen: boolean;
  /** batches with both students placed */
  formed: number;
}
const FacultyCtx = React.createContext<Ctx | null>(null);

export function useFaculty() {
  const c = React.useContext(FacultyCtx);
  if (!c) throw new Error("useFaculty outside FacultyProvider");
  return c;
}

export function FacultyProvider({ initial, children }: { initial: FacultyRow; children: React.ReactNode }) {
  const globalFrozen = useGlobalFreeze();
  const [faculty, setFaculty] = React.useState(initial);
  const [formed, setFormed] = React.useState<number | null>(null);
  const [tick, setTick] = React.useState(0);

  const reload = React.useCallback(async () => {
    const supabase = createClient();
    const [f, b] = await Promise.all([
      supabase.from("faculty").select(FACULTY_COLS).eq("id", initial.id).single(),
      supabase.from("batches").select("id, batch_members(slot)").eq("faculty_id", initial.id),
    ]);
    if (f.data) setFaculty(f.data as FacultyRow);
    if (b.data) setFormed(b.data.filter((x) => x.batch_members.length === 2).length);
    setTick((t) => t + 1);
  }, [initial.id]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  // seats and freeze change live (accept / admin actions), new requests and batch changes arrive live
  useRealtime(
    [
      { table: "faculty", filter: `id=eq.${initial.id}` },
      { table: "requests", filter: `faculty_id=eq.${initial.id}` },
      { table: "batches" }, // deletes cannot be filtered by Realtime; inserts/updates are limited to this faculty by RLS
      { table: "batch_members" },
    ],
    () => void reload(),
  );

  const frozen = globalFrozen || faculty.frozen;
  const value = React.useMemo(
    () => ({ faculty, tick, bump: () => void reload(), frozen, formed: formed ?? 0 }),
    [faculty, tick, reload, frozen, formed],
  );

  const total = batchesForCadre(faculty.cadre);
  const stats = [
    { label: "Cadre", value: CADRE_LABEL[faculty.cadre], icon: <Users className="h-4 w-4" /> },
    { label: "Total seats", value: faculty.total_seats, icon: <Armchair className="h-4 w-4" /> },
    { label: "Filled", value: faculty.accepted_count, icon: <UserCheck className="h-4 w-4" /> },
    { label: "Available seats", value: faculty.available_seats, icon: <Armchair className="h-4 w-4" />, highlight: true },
  ];

  return (
    <FacultyCtx.Provider value={value}>
      {faculty.frozen && !globalFrozen && <FreezeBanner message={MSG.FROZEN_FACULTY} />}
      <section aria-label="Seat summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} className={s.highlight ? "border-primary/50 bg-accent/60 p-4" : "p-4"}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {s.icon}
              {s.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
          </Card>
        ))}
        <Card className="col-span-2 p-4" aria-label="Batches">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers className="h-4 w-4" />
            Batches
          </p>
          <dl className="mt-1 grid grid-cols-3 gap-2">
            {[
              ["Total", total],
              ["Formed", formed ?? "—"],
              ["Remaining", formed === null ? "—" : total - formed],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] text-muted-foreground">{k}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>
      {children}
    </FacultyCtx.Provider>
  );
}
