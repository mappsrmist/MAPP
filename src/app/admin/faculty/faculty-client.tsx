"use client";

import * as React from "react";
import { Download, KeyRound, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { Badge, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PagedTable } from "@/components/paged-table";
import { FACULTY_COLS, PAGE_SIZE } from "@/lib/config";
import { exportTable } from "@/lib/excel";
import { fetchAll } from "@/lib/fetch-all";
import { cleanSearch, useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import { PersonDetailsDialog, type PersonRef } from "@/app/admin/person-details";
import type { FacultyRow } from "@/lib/types";

export function FacultyClient() {
  const supabase = React.useMemo(() => createClient(), []);

  async function download() {
    try {
      const rows = await fetchAll<FacultyRow>((f, t) => supabase.from("faculty").select(FACULTY_COLS).order("name").range(f, t) as unknown as PromiseLike<{ data: FacultyRow[] | null; error: { message: string } | null }>);
      await exportTable("MAPP_Faculty.xlsx", "Faculty", [
        { header: "Emp ID", key: "emp", width: 14 },
        { header: "Name", key: "name", width: 30 },
        { header: "SRM Email", key: "mail", width: 34 },
        { header: "Domain", key: "dom", width: 36 },
        { header: "Filled", key: "filled", width: 10 },
        { header: "Available", key: "avail", width: 10 },
        { header: "Total Seats", key: "total", width: 12 },
        { header: "Frozen", key: "frozen", width: 10 },
      ], rows.map((r) => ({ emp: r.emp_id, name: r.name, mail: r.srm_email, dom: r.domains.join(", "), filled: r.accepted_count, avail: r.available_seats, total: r.total_seats, frozen: r.frozen ? "Yes" : "No" })));
      toast.success("Excel downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Faculty"
        description="Every faculty member with their seats. Freeze a single faculty or reset a password here."
        actions={
          <Button variant="outline" size="sm" onClick={() => void download()}>
            <Download className="h-4 w-4" /> Excel
          </Button>
        }
      />
      <FacultyTable />
    </>
  );
}

function FacultyTable() {
  const [refresh, setRefresh] = React.useState(0);
  const onChange = () => setRefresh((n) => n + 1);
  const supabase = React.useMemo(() => createClient(), []);
  const [person, setPerson] = React.useState<PersonRef | null>(null);
  const [confirm, setConfirm] = React.useState<null | { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<void> }>(null);

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(fn, args);
    if (error) toast.error(error.message);
    else toast.success(ok);
    onChange();
  }

  async function resetPassword(profileId: string) {
    const res = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) toast.success(`Password reset. ${json.username} signs in with their employee ID and must choose a new password.`);
    else toast.error(json.error ?? "Could not reset password");
  }

  useRealtime([{ table: "faculty" }], onChange);

  return (
    <>
      <PagedTable<FacultyRow>
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
          { header: "Name", cell: (r) => <button type="button" className="cursor-pointer text-left font-medium text-primary hover:underline" onClick={() => setPerson({ kind: "faculty", id: r.id })}>{r.name}</button> },
          { header: "SRM Email", cell: (r) => <span className="break-all text-xs">{r.srm_email}</span> },
          { header: "Phone", cell: (r) => r.phone ?? "—" },
          { header: "Domain", cell: (r) => (r.domains.length ? r.domains.join(", ") : "—") },
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setConfirm({
                    title: `Reset password for ${r.name}?`,
                    description: "The password goes back to the employee ID and the faculty member must choose a new one at next login.",
                    label: "Reset password",
                    run: () => resetPassword(r.id),
                  })
                }
              >
                <KeyRound className="h-3.5 w-3.5" /> Reset
              </Button>
            ),
          },
        ]}
      />
      <PersonDetailsDialog person={person} onClose={() => setPerson(null)} />
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
