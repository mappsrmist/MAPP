"use client";

import * as React from "react";
import { Snowflake, Sun } from "lucide-react";
import { toast } from "sonner";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PagedTable } from "@/components/paged-table";
import { PAGE_SIZE } from "@/lib/config";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { AuditEntry } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  freeze: "Freeze",
  unfreeze: "Unfreeze",
  remove_allocation: "Removed from faculty",
  edit_section: "Edited section",
  move_student: "Moved to another faculty",
  reset_request: "Reset to Pending",
  application_status: "Application status changed",
};

/** One short line describing what an audit entry touched (reg no / employee id, never raw ids). */
function describe(e: AuditEntry) {
  const d = e.details as Record<string, string | undefined>;
  return [
    d.name,
    d.reg_no && `student ${d.reg_no}`,
    d.emp_id && `faculty ${d.emp_id}`,
    d.to_emp_id && `to faculty ${d.to_emp_id}`,
    d.section && `section ${d.section}`,
    d.was && `was ${d.was}`,
    d.status && `status ${d.status}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function SettingsClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const [frozen, setFrozen] = React.useState<boolean | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.from("system_settings").select("global_frozen").eq("id", 1).single();
    if (error) return void toast.error(error.message);
    setFrozen(data.global_frozen);
  }, [supabase]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useRealtime([{ table: "system_settings" }], () => {
    void load();
    setRefresh((n) => n + 1);
  });

  async function toggle() {
    const next = !frozen;
    const { error } = await supabase.rpc("admin_set_global_freeze", { p_frozen: next });
    if (error) toast.error(error.message);
    else toast.success(next ? "Allocations frozen" : "Allocations unfrozen");
    await load();
    setRefresh((n) => n + 1);
  }

  return (
    <>
      <PageHeader title="Settings & Freeze" description="Lock all allocation activity when the allocation window closes." />

      <Card className="mb-8">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Global freeze
              {frozen === null ? null : <Badge tone={frozen ? "warning" : "success"}>{frozen ? "Frozen" : "Open"}</Badge>}
            </CardTitle>
            <CardDescription>
              While frozen, students cannot send requests, opt for MOOC or edit applications, and faculty cannot accept, decline, group, ungroup or edit
              batches. Viewing and downloads keep working, and so do admin actions. A single faculty can be frozen from the Overview page.
            </CardDescription>
          </div>
          {frozen === null ? (
            <Skeleton className="h-10 w-36" />
          ) : (
            <Button variant={frozen ? "default" : "destructive"} onClick={() => setConfirm(true)}>
              {frozen ? <Sun className="h-4 w-4" /> : <Snowflake className="h-4 w-4" />}
              {frozen ? "Unfreeze allocations" : "Freeze allocations"}
            </Button>
          )}
        </CardHeader>
        <CardContent />
      </Card>

      <h2 className="mb-3 text-lg font-semibold">Audit log</h2>
      <PagedTable<AuditEntry>
        rowKey={(r) => String(r.id)}
        refreshKey={refresh}
        hideSearch
        emptyTitle="Nothing logged yet"
        emptyHint="Freezes and admin allocation actions are recorded here."
        onError={(m) => toast.error(m)}
        fetchPage={async (page, _search, signal) => {
          const { data, count, error } = await supabase
            .from("audit_log")
            .select("*", { count: "exact" })
            .order("id", { ascending: false })
            .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
            .abortSignal(signal);
          if (error) throw new Error(error.message);
          return { rows: (data ?? []) as AuditEntry[], total: count ?? 0 };
        }}
        columns={[
          { header: "When", cell: (r) => <span className="whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-GB")}</span> },
          { header: "Action", cell: (r) => <span className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</span> },
          { header: "Scope", cell: (r) => <Badge className="capitalize">{r.scope}</Badge> },
          { header: "Details", cell: (r) => <span className="text-muted-foreground">{describe(r) || "—"}</span> },
        ]}
      />

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={frozen ? "Unfreeze allocations?" : "Freeze all allocations?"}
        description={
          frozen
            ? "Students and faculty can make changes again."
            : "Students and faculty will immediately be unable to make allocation changes. This is logged."
        }
        confirmLabel={frozen ? "Unfreeze" : "Freeze"}
        destructive={!frozen}
        onConfirm={toggle}
      />
    </>
  );
}
