"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, PageHeader, Skeleton } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { ClassOverview } from "@/components/class-overview";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { AdminStats, SectionRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StudentList } from "./student-list";

type TabKey = "mooc_pending" | "mooc" | "not_opted";
const TABS: { key: TabKey; label: string }[] = [
  { key: "mooc_pending", label: "MOOC pending" },
  { key: "mooc", label: "MOOC Opted" },
  { key: "not_opted", label: "Not Opted" },
];

export function OverviewClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const [stats, setStats] = React.useState<AdminStats | null>(null);
  const [sections, setSections] = React.useState<SectionRow[]>([]);
  const [tab, setTab] = React.useState<TabKey>("mooc");
  const [section, setSection] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);

  const load = React.useCallback(async () => {
    const [s, sec] = await Promise.all([supabase.rpc("admin_stats"), supabase.rpc("admin_sections")]);
    if (s.error) return void toast.error(s.error.message);
    setStats(s.data as AdminStats);
    if (!sec.error) setSections((sec.data ?? []) as SectionRow[]);
  }, [supabase]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refresh]);

  useRealtime([{ table: "students" }], () => setRefresh((n) => n + 1));

  const current = sections.find((s) => s.section === section);
  const cards = stats
    ? [
        { label: "Total Students", value: stats.students },
        { label: "Total Faculty", value: stats.faculty },
        { label: "Minor", value: stats.minor },
        { label: "MOOC Opted", value: stats.mooc },
        { label: "MOOC pending", value: stats.mooc_pending },
        { label: "Not Opted", value: stats.not_opted },
      ]
    : null;

  return (
    <>
      <PageHeader title="Overview" description="Where every student stands. Allocations, freeze controls and imports have their own pages." />

      <section aria-label="Statistics" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards
          ? cards.map((c) => (
              <Card key={c.label} className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</p>
              </Card>
            ))
          : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}
      </section>
      {stats && <p className="-mt-3 mb-6 text-xs text-muted-foreground">Exempt from MOOC and Minor: {stats.exempt}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="section-view" className="text-sm font-medium">
          Section
        </label>
        <Select id="section-view" value={section} onChange={(e) => setSection(e.target.value)} className="w-44">
          <option value="">All sections</option>
          {sections.map((s) => (
            <option key={s.section} value={s.section}>
              {s.section} ({s.student_count})
            </option>
          ))}
        </Select>
        {section && (
          <span className="text-sm text-muted-foreground">
            Faculty Advisor: <span className="font-medium text-foreground">{current?.fa_name ?? "—"}</span>
            {current?.fa_emp_id && <span className="ml-1 font-mono text-xs">({current.fa_emp_id})</span>}
          </span>
        )}
      </div>

      {section ? (
        <ClassOverview section={section} />
      ) : (
        <>
          <div role="tablist" aria-label="Tables" className="mb-4 flex flex-wrap gap-1 rounded-xl bg-muted p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn("cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <StudentList kind={tab} refreshKey={refresh} onChanged={() => setRefresh((n) => n + 1)} />
        </>
      )}
    </>
  );
}
