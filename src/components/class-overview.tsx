"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PagedTable } from "@/components/paged-table";
import { exportTable, safeFilePart } from "@/lib/excel";
import { createClient } from "@/lib/supabase/client";
import type { ClassCounts, ClassRow, ClassStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const CLASS_STATUS_LABEL: Record<ClassStatus, string> = {
  minor: "Minor",
  mooc: "MOOC approved",
  mooc_pending: "MOOC pending",
  not_opted: "Not opted",
  exempt: "Exempt",
};
const STATUS_TONE = { minor: "info", mooc: "success", mooc_pending: "warning", not_opted: "warning", exempt: "neutral" } as const;
const REQUEST_LABEL = { pending: "Pending", accepted: "Accepted", declined: "Declined", grouped: "Grouped" } as const;

const CHIPS: { key: ClassStatus | null; label: string; count: "total" | ClassStatus }[] = [
  { key: null, label: "Total", count: "total" },
  { key: "minor", label: "Minor", count: "minor" },
  { key: "mooc", label: "MOOC approved", count: "mooc" },
  { key: "mooc_pending", label: "MOOC pending", count: "mooc_pending" },
  { key: "not_opted", label: "Not opted", count: "not_opted" },
  { key: "exempt", label: "Exempt", count: "exempt" },
];

/**
 * Read-only class list for one section. Used by the Faculty Advisor page and, identically, by the admin Section
 * view. The RPCs verify that the caller is the section's advisor (or the admin), so this component trusts nothing.
 */
export function ClassOverview({ section, refreshKey = 0 }: { section: string; refreshKey?: number }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [loaded, setLoaded] = React.useState<{ section: string; counts: ClassCounts } | null>(null);
  const [status, setStatus] = React.useState<ClassStatus | null>(null);
  const counts = loaded?.section === section ? loaded.counts : null;

  React.useEffect(() => {
    let live = true;
    void supabase.rpc("fa_class_counts", { p_section: section }).then(({ data, error }) => {
      if (!live) return;
      if (error) toast.error(error.message);
      else setLoaded({ section, counts: data as ClassCounts });
    });
    return () => {
      live = false;
    };
  }, [supabase, section, refreshKey]);

  async function download() {
    const { data, error } = await supabase.rpc("fa_class_overview", { p_section: section, p_search: null, p_status: status, p_page: 0 });
    if (error) return void toast.error(error.message);
    const rows = (data ?? []) as ClassRow[];
    await exportTable(
      `MAPP_Class_${safeFilePart(section)}.xlsx`,
      `Section ${section}`,
      [
        { header: "Reg No", key: "reg", width: 22 },
        { header: "Name", key: "name", width: 30 },
        { header: "Section", key: "section", width: 10 },
        { header: "Student SRM Mail", key: "mail", width: 34 },
        { header: "Status", key: "status", width: 12 },
        { header: "Guide", key: "guide", width: 28 },
        { header: "Request Status", key: "req", width: 14 },
        { header: "Project Title", key: "title", width: 36 },
      ],
      rows.map((r) => ({
        reg: r.reg_no,
        name: r.name,
        section: r.section ?? "",
        mail: r.email ?? "",
        status: CLASS_STATUS_LABEL[r.status],
        guide: r.guide_name ?? "",
        req: r.request_status ? REQUEST_LABEL[r.request_status] : "",
        title: r.project_title ?? "",
      })),
    );
    toast.success("Excel downloaded");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Faculty Advisor: <span className="font-medium text-foreground">{counts ? (counts.fa_name ?? "—") : "…"}</span>
          {counts?.fa_emp_id && <span className="ml-1 font-mono text-xs">({counts.fa_emp_id})</span>}
        </p>
        <Button variant="outline" size="sm" onClick={() => void download()}>
          <Download className="h-4 w-4" /> Download Excel
        </Button>
      </div>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={status === c.key}
            onClick={() => setStatus(c.key)}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors",
              status === c.key ? "border-primary bg-accent font-medium" : "hover:bg-muted",
            )}
          >
            {c.label} <span className="ml-1 font-semibold tabular-nums">{counts ? counts[c.count] : "–"}</span>
          </button>
        ))}
      </div>

      <PagedTable<ClassRow>
        key={section}
        rowKey={(r) => r.student_id}
        deps={[status]}
        refreshKey={refreshKey}
        searchPlaceholder="Search by registration number or name"
        emptyTitle="No students match"
        onError={(m) => toast.error(m)}
        fetchPage={async (page, search) => {
          const { data, error } = await supabase.rpc("fa_class_overview", { p_section: section, p_search: search || null, p_status: status, p_page: page });
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as ClassRow[];
          return { rows, total: Number(rows[0]?.total_count ?? 0) };
        }}
        columns={[
          { header: "Reg No", cell: (r) => <span className="font-mono text-xs">{r.reg_no}</span> },
          { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
          { header: "Section", cell: (r) => r.section ?? "—" },
          { header: "Student SRM Mail", cell: (r) => r.email ?? "—" },
          { header: "Status", cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{CLASS_STATUS_LABEL[r.status]}</Badge> },
          { header: "Guide (Minor)", cell: (r) => r.guide_name ?? "—" },
          { header: "Request Status", cell: (r) => (r.request_status ? REQUEST_LABEL[r.request_status] : "—") },
          { header: "Project Title", cell: (r) => r.project_title ?? "—" },
        ]}
      />
    </div>
  );
}
