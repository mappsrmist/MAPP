"use client";

import * as React from "react";
import { Armchair, Layers, UserCheck, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CADRE_LABEL, FACULTY_COLS, batchesForCadre } from "@/lib/config";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { FacultyRow } from "@/lib/types";

interface Ctx {
  faculty: FacultyRow;
  /** increments on every realtime change to requests / the faculty row; pages use it to refetch */
  tick: number;
  bump: () => void;
}
const FacultyCtx = React.createContext<Ctx | null>(null);

export function useFaculty() {
  const c = React.useContext(FacultyCtx);
  if (!c) throw new Error("useFaculty outside FacultyProvider");
  return c;
}

export function FacultyProvider({ initial, children }: { initial: FacultyRow; children: React.ReactNode }) {
  const [faculty, setFaculty] = React.useState(initial);
  const [tick, setTick] = React.useState(0);

  const reload = React.useCallback(async () => {
    const { data } = await createClient().from("faculty").select(FACULTY_COLS).eq("id", initial.id).single();
    if (data) setFaculty(data as FacultyRow);
    setTick((t) => t + 1);
  }, [initial.id]);

  // seats change live (accept / admin removal), new requests arrive live
  useRealtime([{ table: "faculty", filter: `id=eq.${initial.id}` }, { table: "requests", filter: `faculty_id=eq.${initial.id}` }], () => void reload());

  const value = React.useMemo(() => ({ faculty, tick, bump: () => void reload() }), [faculty, tick, reload]);

  const stats = [
    { label: "Cadre", value: CADRE_LABEL[faculty.cadre], icon: <Users className="h-4 w-4" /> },
    { label: "Total seats", value: faculty.total_seats, icon: <Armchair className="h-4 w-4" /> },
    { label: "Filled", value: faculty.accepted_count, icon: <UserCheck className="h-4 w-4" /> },
    { label: "Available seats", value: faculty.available_seats, icon: <Armchair className="h-4 w-4" />, highlight: true },
    { label: "Batches", value: batchesForCadre(faculty.cadre), icon: <Layers className="h-4 w-4" /> },
  ];

  return (
    <FacultyCtx.Provider value={value}>
      <section aria-label="Seat summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className={s.highlight ? "border-primary/50 bg-accent/60 p-4" : "p-4"}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {s.icon}
              {s.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
          </Card>
        ))}
      </section>
      {children}
    </FacultyCtx.Provider>
  );
}
