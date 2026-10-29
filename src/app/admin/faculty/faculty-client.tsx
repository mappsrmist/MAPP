"use client";

import * as React from "react";
import { KeyRound, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { Badge, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PagedTable } from "@/components/paged-table";
import { FACULTY_COLS, PAGE_SIZE } from "@/lib/config";
import { cleanSearch, useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { FacultyRow } from "@/lib/types";

export function FacultyClient() {
  return (
    <>
      <PageHeader title="Faculty" description="Every faculty member with their seats. Freeze a single faculty or reset a password here." />
      <FacultyTable />
    </>
  );
}

function FacultyTable() {
  const [refresh, setRefresh] = React.useState(0);
  const onChange = () => setRefresh((n) => n + 1);
  const supabase = React.useMemo(() => createClient(), []);
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
          { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
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
