"use client";

import * as React from "react";
import { Download, KeyRound, RotateCcw, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PagedTable } from "@/components/paged-table";
import { CADRE_LABEL, FACULTY_COLS, PAGE_SIZE } from "@/lib/config";
import { fetchAll } from "@/lib/fetch-all";
import { exportTable } from "@/lib/excel";
import { cleanSearch, useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { FacultyRow, StudentRow } from "@/lib/types";
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

type TabKey = "mooc" | "none" | "faculty";
const TABS: { key: TabKey; label: string }[] = [
  { key: "faculty", label: "Faculty & seats" },
  { key: "mooc", label: "MOOC opted" },
  { key: "none", label: "No choice yet" },
];

export function OverviewClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [tab, setTab] = React.useState<TabKey>("faculty");
  const [refresh, setRefresh] = React.useState(0);
  const [confirm, setConfirm] = React.useState<null | { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<void> }>(null);

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
    if (res.ok) toast.success(`Password reset. ${json.username} signs in with their ${json.role === "student" ? "registration number" : "employee ID"} and must choose a new password.`);
    else toast.error(json.error ?? "Could not reset password");
  }

  const askReset = (id: string, who: string) =>
    setConfirm({
      title: `Reset password for ${who}?`,
      description: "The password goes back to the initial one (registration number for students, employee ID for faculty). The user must choose a new password at next login.",
      label: "Reset password",
      run: () => resetPassword(id),
    });

  // ---------------------------------------------------------------- exports
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
        description="Live status across the portal. Allocations and freeze controls have their own pages."
        actions={
          <div className="flex flex-wrap gap-2">
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

      {tab === "faculty" && (
        <PagedTable<FacultyRow>
          key="faculty"
          rowKey={(r) => r.id}
          refreshKey={refresh}
          searchPlaceholder="Search by name or employee ID"
          onError={(m) => toast.error(m)}
          fetchPage={async (page, search, signal) => {
            let q = supabase.from("faculty").select(FACULTY_COLS, { count: "exact" }).order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
            const term = cleanSearch(search);
            if (term) q = q.or(`name.ilike.%${term}%,emp_id.ilike.%${term}%`);
            const { data, count, error } = await q.abortSignal(signal);
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
              header: "Freeze",
              cell: (r) => (
                <Button
                  size="sm"
                  variant={r.frozen ? "default" : "outline"}
                  aria-pressed={r.frozen}
                  onClick={() =>
                    setConfirm({
                      title: r.frozen ? `Unfreeze ${r.name}?` : `Freeze ${r.name}?`,
                      description: r.frozen
                        ? "This faculty can accept, decline and group students again."
                        : "This faculty can no longer accept, decline, group, ungroup or edit batches. They can still view and download.",
                      label: r.frozen ? "Unfreeze" : "Freeze",
                      destructive: !r.frozen,
                      run: () => rpc("admin_set_faculty_freeze", { p_faculty: r.id, p_frozen: !r.frozen }, r.frozen ? "Faculty unfrozen" : "Faculty frozen"),
                    })
                  }
                >
                  <Snowflake className="h-3.5 w-3.5" /> {r.frozen ? "Frozen" : "Freeze"}
                </Button>
              ),
            },
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
          fetchPage={async (page, search, signal) => {
            let q = supabase.from("students").select("*", { count: "exact" }).order("reg_no").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
            q = tab === "mooc" ? q.eq("choice", "mooc") : q.is("choice", null);
            const term = cleanSearch(search);
            if (term) q = q.or(`reg_no.ilike.%${term}%,name.ilike.%${term}%`);
            const { data, count, error } = await q.abortSignal(signal);
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
        destructive={confirm?.destructive ?? true}
        onConfirm={() => confirm?.run()}
      />
    </>
  );
}
