"use client";

import * as React from "react";
import { Download, KeyRound, RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, PageHeader, Skeleton, StatusBadge } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PagedTable } from "@/components/paged-table";
import { CADRE_LABEL, FACULTY_COLS, PAGE_SIZE } from "@/lib/config";
import { exportTable } from "@/lib/excel";
import { cleanSearch, useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { FacultyRow, RequestDetail, StudentRow } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Stats {
  students: number;
  faculty: number;
  mooc: number;
  pending: number;
  accepted: number;
  declined: number;
  no_choice: number;
  total_seats: number;
  filled_seats: number;
}

type TabKey = "mooc" | "none" | "faculty" | "alloc";
const TABS: { key: TabKey; label: string }[] = [
  { key: "alloc", label: "Allocations" },
  { key: "faculty", label: "Faculty & seats" },
  { key: "mooc", label: "MOOC opted" },
  { key: "none", label: "No choice yet" },
];

/** Pulls every row of a (possibly large) query, 1000 at a time, for Excel exports. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export function OverviewClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [tab, setTab] = React.useState<TabKey>("alloc");
  const [refresh, setRefresh] = React.useState(0);
  const [confirm, setConfirm] = React.useState<null | { title: string; description: string; label: string; run: () => Promise<void> }>(null);

  const loadStats = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_stats");
    if (error) return void toast.error(error.message);
    setStats(data as Stats);
  }, [supabase]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStats();
  }, [loadStats, refresh]);

  useRealtime([{ table: "requests" }, { table: "faculty" }], () => setRefresh((n) => n + 1));

  const bump = () => setRefresh((n) => n + 1);

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(fn, args);
    if (error) toast.error(error.message);
    else toast.success(ok);
    bump();
  }

  async function resetPassword(profileId: string) {
    const res = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) toast.success("Password reset to default. The user must change it on next login.");
    else toast.error(json.error ?? "Could not reset password");
  }

  const askReset = (id: string, who: string) =>
    setConfirm({
      title: `Reset password for ${who}?`,
      description: "The password is set back to its default and the user must choose a new one at next login.",
      label: "Reset password",
      run: () => resetPassword(id),
    });

  // ---------------------------------------------------------------- exports
  async function exportAllocations() {
    const rows = await fetchAll<RequestDetail>((f, t) =>
      supabase.from("request_details_v").select("*").eq("status", "accepted").order("faculty_name").order("batch_no").order("slot").range(f, t),
    );
    await exportTable("MAPP_Allocations.xlsx", "Allocations", [
      { header: "Faculty Emp ID", key: "fe", width: 16 },
      { header: "Faculty", key: "fn", width: 28 },
      { header: "Batch", key: "b", width: 12 },
      { header: "Registration No.", key: "r", width: 22 },
      { header: "Student", key: "s", width: 28 },
      { header: "Dept", key: "d", width: 14 },
      { header: "Section", key: "sec", width: 10 },
    ], rows.map((r) => ({ fe: r.faculty_emp_id, fn: r.faculty_name, b: r.batch_no ? `B${r.batch_no}` : "Unassigned", r: r.reg_no, s: r.student_name, d: r.dept, sec: r.student_section ?? "" })));
  }

  async function exportStudents(kind: "mooc" | "none") {
    const rows = await fetchAll<StudentRow>((f, t) => {
      let q = supabase.from("students").select("*").order("reg_no").range(f, t);
      q = kind === "mooc" ? q.eq("choice", "mooc") : q.is("choice", null);
      return q;
    });
    await exportTable(kind === "mooc" ? "MAPP_MOOC_Students.xlsx" : "MAPP_Students_No_Choice.xlsx", kind === "mooc" ? "MOOC" : "No choice", [
      { header: "Registration No.", key: "reg_no", width: 22 },
      { header: "Name", key: "name", width: 30 },
      { header: "Dept", key: "dept", width: 14 },
      { header: "Section", key: "section", width: 10 },
      { header: "Email", key: "email", width: 32 },
    ], rows.map((r) => ({ ...r })));
  }

  const run = (p: Promise<void>) => p.then(() => toast.success("Excel downloaded")).catch((e) => toast.error(e instanceof Error ? e.message : "Export failed"));

  const cards = stats
    ? [
        { label: "Students", value: stats.students },
        { label: "Faculty", value: stats.faculty },
        { label: "MOOC opted", value: stats.mooc },
        { label: "Requests pending", value: stats.pending },
        { label: "Requests accepted", value: stats.accepted },
        { label: "Requests declined", value: stats.declined },
        { label: "No choice yet", value: stats.no_choice },
        { label: "Seats filled / total", value: `${stats.filled_seats} / ${stats.total_seats}` },
      ]
    : null;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live status of allocations across the portal."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => run(exportAllocations())}>
              <Download className="h-4 w-4" /> Allocations
            </Button>
            <Button variant="outline" size="sm" onClick={() => run(exportStudents("mooc"))}>
              <Download className="h-4 w-4" /> MOOC list
            </Button>
            <Button variant="outline" size="sm" onClick={() => run(exportStudents("none"))}>
              <Download className="h-4 w-4" /> No choice
            </Button>
          </div>
        }
      />

      <section aria-label="Statistics" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards
          ? cards.map((c) => (
              <Card key={c.label} className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</p>
              </Card>
            ))
          : Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}
      </section>

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

      {tab === "alloc" && (
        <PagedTable<RequestDetail>
          key="alloc"
          rowKey={(r) => r.id}
          refreshKey={refresh}
          searchPlaceholder="Search student or faculty"
          emptyTitle="No allocations yet"
          onError={(m) => toast.error(m)}
          fetchPage={async (page, search) => {
            let q = supabase
              .from("request_details_v")
              .select("*", { count: "exact" })
              .eq("status", "accepted")
              .order("faculty_name")
              .order("batch_no", { nullsFirst: false })
              .order("slot")
              .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
            const term = cleanSearch(search);
            if (term) q = q.or(`reg_no.ilike.%${term}%,student_name.ilike.%${term}%,faculty_name.ilike.%${term}%,faculty_emp_id.ilike.%${term}%`);
            const { data, count, error } = await q;
            if (error) throw new Error(error.message);
            return { rows: (data ?? []) as RequestDetail[], total: count ?? 0 };
          }}
          columns={[
            { header: "Faculty", cell: (r) => (<><span className="font-medium">{r.faculty_name}</span><span className="block font-mono text-xs text-muted-foreground">{r.faculty_emp_id}</span></>) },
            { header: "Batch", cell: (r) => (r.batch_no ? <Badge tone="info">B{r.batch_no}</Badge> : <Badge>Unassigned</Badge>) },
            { header: "Student", cell: (r) => (<><span className="font-medium">{r.student_name}</span><span className="block font-mono text-xs text-muted-foreground">{r.reg_no}</span></>) },
            { header: "Dept", cell: (r) => r.dept },
            { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            {
              header: "Action",
              cell: (r) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setConfirm({
                      title: `Remove ${r.student_name} from ${r.faculty_name}?`,
                      description: "This frees the faculty's seat and unlocks the student's Minor portal.",
                      label: "Remove",
                      run: () => rpc("admin_remove_accepted", { p_request_id: r.id }, "Allocation removed"),
                    })
                  }
                >
                  <UserMinus className="h-3.5 w-3.5" /> Remove
                </Button>
              ),
            },
          ]}
        />
      )}

      {tab === "faculty" && (
        <PagedTable<FacultyRow>
          key="faculty"
          rowKey={(r) => r.id}
          refreshKey={refresh}
          searchPlaceholder="Search by name or employee ID"
          onError={(m) => toast.error(m)}
          fetchPage={async (page, search) => {
            let q = supabase.from("faculty").select(FACULTY_COLS, { count: "exact" }).order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
            const term = cleanSearch(search);
            if (term) q = q.or(`name.ilike.%${term}%,emp_id.ilike.%${term}%`);
            const { data, count, error } = await q;
            if (error) throw new Error(error.message);
            return { rows: (data ?? []) as unknown as FacultyRow[], total: count ?? 0 };
          }}
          columns={[
            { header: "Emp ID", cell: (r) => <span className="font-mono text-xs">{r.emp_id}</span> },
            { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
            { header: "Cadre", cell: (r) => CADRE_LABEL[r.cadre] },
            { header: "Filled", cell: (r) => r.accepted_count },
            { header: "Available", cell: (r) => <Badge tone={r.available_seats > 0 ? "success" : "danger"}>{r.available_seats} / {r.total_seats}</Badge> },
            {
              header: "Password",
              cell: (r) => (
                <Button size="sm" variant="ghost" onClick={() => askReset(r.id, r.name)}>
                  <KeyRound className="h-3.5 w-3.5" /> Reset
                </Button>
              ),
            },
          ]}
        />
      )}

      {(tab === "mooc" || tab === "none") && (
        <PagedTable<StudentRow>
          key={tab}
          rowKey={(r) => r.id}
          refreshKey={refresh}
          searchPlaceholder="Search by registration number or name"
          emptyTitle={tab === "mooc" ? "No MOOC selections yet" : "Everyone has made a choice"}
          onError={(m) => toast.error(m)}
          fetchPage={async (page, search) => {
            let q = supabase.from("students").select("*", { count: "exact" }).order("reg_no").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
            q = tab === "mooc" ? q.eq("choice", "mooc") : q.is("choice", null);
            const term = cleanSearch(search);
            if (term) q = q.or(`reg_no.ilike.%${term}%,name.ilike.%${term}%`);
            const { data, count, error } = await q;
            if (error) throw new Error(error.message);
            return { rows: (data ?? []) as StudentRow[], total: count ?? 0 };
          }}
          columns={[
            { header: "Registration No.", cell: (r) => <span className="font-mono text-xs">{r.reg_no}</span> },
            { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
            { header: "Dept", cell: (r) => r.dept },
            { header: "Section", cell: (r) => r.section ?? "—" },
            {
              header: "Actions",
              cell: (r) => (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => askReset(r.id, r.name)}>
                    <KeyRound className="h-3.5 w-3.5" /> Reset password
                  </Button>
                  {tab === "mooc" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setConfirm({
                          title: `Undo MOOC choice for ${r.name}?`,
                          description: "The student can then choose MOOC or Minor again.",
                          label: "Undo choice",
                          run: () => rpc("admin_reset_choice", { p_student_id: r.id }, "Choice reset"),
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Undo MOOC
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel={confirm?.label}
        destructive
        onConfirm={() => confirm?.run()}
      />
    </>
  );
}
