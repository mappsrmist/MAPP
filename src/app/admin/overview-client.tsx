"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, PageHeader, Skeleton } from "@/components/ui/card";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { AdminStats } from "@/lib/types";

export function OverviewClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const [stats, setStats] = React.useState<AdminStats | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_stats");
    if (error) return void toast.error(error.message);
    setStats(data as AdminStats);
  }, [supabase]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refresh]);

  useRealtime([{ table: "students" }, { table: "faculty" }], () => setRefresh((n) => n + 1));

  const cards = stats
    ? [
        { label: "Total Students", value: stats.students },
        { label: "Total Faculty", value: stats.faculty },
        { label: "Minor", value: stats.minor },
        { label: "MOOC Opted", value: stats.mooc },
        { label: "MOOC pending", value: stats.mooc_pending },
        { label: "Not Opted", value: stats.not_opted },
        { label: "Exempt", value: stats.exempt },
      ]
    : null;

  return (
    <>
      <PageHeader title="Overview" description="The numbers at a glance. Student lists are on the Students page, seats on the Faculty page." />
      <section aria-label="Statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards
          ? cards.map((c) => (
              <Card key={c.label} className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</p>
              </Card>
            ))
          : Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-20" />)}
      </section>
    </>
  );
}
