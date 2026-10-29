"use client";

import * as React from "react";
import { Ban, Download, KeyRound, RotateCcw, Undo2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { PagedTable } from "@/components/paged-table";
import { exportTable } from "@/lib/excel";
import { createClient } from "@/lib/supabase/client";
import type { AdminStudentRow } from "@/lib/types";

export type StudentListKind = "mooc_pending" | "mooc" | "not_opted" | "exempt" | "removed";

const COPY: Record<StudentListKind, { empty: string; file: string }> = {
  mooc_pending: { empty: "No MOOC requests awaiting approval", file: "MAPP_MOOC_Pending.xlsx" },
  mooc: { empty: "No MOOC selections yet", file: "MAPP_MOOC_Students.xlsx" },
  not_opted: { empty: "Everyone has made a choice", file: "MAPP_Students_Not_Opted.xlsx" },
  exempt: { empty: "No exempt students", file: "MAPP_Exempt_Students.xlsx" },
  removed: { empty: "No removed students", file: "MAPP_Removed_Students.xlsx" },
};

type Pending =
  | { kind: "remove" | "restore" | "undo-exempt" | "undo-mooc"; ids: string[]; label: string }
  | { kind: "reset"; ids: string[]; label: string };

/**
 * Admin student table: Reg No | Name | Section | Student SRM Mail | Faculty Advisor Name.
 * Not-opted rows can be selected for the bulk Remove / Exempt actions; every action asks for confirmation.
 */
export function StudentList({ kind, refreshKey = 0, onChanged }: { kind: StudentListKind; refreshKey?: number; onChanged?: () => void }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [local, setLocal] = React.useState(0);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [exempt, setExempt] = React.useState<{ ids: string[]; label: string } | null>(null);
  const selectable = kind === "not_opted";

  const done = () => {
    setSelected(new Set());
    setLocal((n) => n + 1);
    onChanged?.();
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function students(action: "remove" | "restore", ids: string[]) {
    const res = await fetch("/api/admin/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(json.error ?? "Could not complete the action");
    else {
      toast.success(action === "remove" ? `${json.count} student(s) removed` : `${json.count} student(s) restored`);
      if (json.loginFailures) toast.warning("The database now blocks these students, but their login could not be updated. Try again.");
    }
    done();
  }

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(fn, args);
    if (error) toast.error(error.message);
    else toast.success(ok);
    done();
  }

  async function resetPassword(profileId: string) {
    const res = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) toast.success(`Password reset. ${json.username} signs in with their registration number and must choose a new password.`);
    else toast.error(json.error ?? "Could not reset password");
  }

  async function runPending() {
    const p = pending!;
    if (p.kind === "remove" || p.kind === "restore") return students(p.kind, p.ids);
    if (p.kind === "undo-exempt") return rpc("admin_set_exempt", { p_ids: p.ids, p_exempt: false, p_reason: null }, "Exemption undone");
    if (p.kind === "undo-mooc") return rpc("admin_reset_choice", { p_student_id: p.ids[0] }, "Choice reset");
    return resetPassword(p.ids[0]);
  }

  async function download() {
    const { data, error } = await supabase.rpc("admin_list_students", { p_kind: kind, p_search: null, p_page: 0 });
    if (error) return void toast.error(error.message);
    await exportTable(COPY[kind].file, kind, [
      { header: "Reg No", key: "reg", width: 22 },
      { header: "Name", key: "name", width: 30 },
      { header: "Section", key: "section", width: 10 },
      { header: "Student SRM Mail", key: "mail", width: 34 },
      { header: "Faculty Advisor Name", key: "fa", width: 28 },
    ], ((data ?? []) as AdminStudentRow[]).map((r) => ({ reg: r.reg_no, name: r.name, section: r.section ?? "", mail: r.email ?? "", fa: r.fa_name ?? "" })));
    toast.success("Excel downloaded");
  }

  const bulk = [...selected];

  return (
    <>
      <PagedTable<AdminStudentRow>
        key={kind}
        rowKey={(r) => r.id}
        refreshKey={refreshKey + local}
        searchPlaceholder="Search by registration number or name"
        emptyTitle={COPY[kind].empty}
        onError={(m) => toast.error(m)}
        toolbar={
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {selectable && bulk.length > 0 && (
              <>
                <span className="text-sm text-muted-foreground">{bulk.length} selected</span>
                <Button size="sm" variant="outline" onClick={() => setExempt({ ids: bulk, label: `${bulk.length} student(s)` })}>
                  <Ban className="h-3.5 w-3.5" /> Exempt
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setPending({ kind: "remove", ids: bulk, label: `${bulk.length} student(s)` })}>
                  <UserMinus className="h-3.5 w-3.5" /> Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => void download()}>
              <Download className="h-4 w-4" /> Excel
            </Button>
          </div>
        }
        fetchPage={async (page, search, signal) => {
          const { data, error } = await supabase.rpc("admin_list_students", { p_kind: kind, p_search: search || null, p_page: page }).abortSignal(signal);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as AdminStudentRow[];
          return { rows, total: Number(rows[0]?.total_count ?? 0) };
        }}
        columns={[
          ...(selectable
            ? [{
                header: "Select",
                cell: (r: AdminStudentRow) => (
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.name}`}
                    className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                ),
              }]
            : []),
          { header: "Reg No", cell: (r) => <span className="font-mono text-xs">{r.reg_no}</span> },
          { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
          { header: "Section", cell: (r) => r.section ?? "—" },
          { header: "Student SRM Mail", cell: (r) => r.email ?? "—" },
          { header: "Faculty Advisor Name", cell: (r) => r.fa_name ?? "—" },
          ...(kind === "exempt" ? [{ header: "Reason", cell: (r: AdminStudentRow) => r.exempt_reason ?? "—" }] : []),
          {
            header: "Actions",
            cell: (r) => (
              <div className="flex flex-wrap gap-1">
                {kind !== "removed" && (
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "reset", ids: [r.id], label: r.name })}>
                    <KeyRound className="h-3.5 w-3.5" /> Reset password
                  </Button>
                )}
                {kind === "mooc" && (
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "undo-mooc", ids: [r.id], label: r.name })}>
                    <RotateCcw className="h-3.5 w-3.5" /> Undo MOOC
                  </Button>
                )}
                {kind === "not_opted" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setExempt({ ids: [r.id], label: r.name })}>
                      <Ban className="h-3.5 w-3.5" /> Exempt
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setPending({ kind: "remove", ids: [r.id], label: r.name })}>
                      <UserMinus className="h-3.5 w-3.5" /> Remove
                    </Button>
                  </>
                )}
                {kind === "exempt" && (
                  <Button size="sm" variant="outline" onClick={() => setPending({ kind: "undo-exempt", ids: [r.id], label: r.name })}>
                    <Undo2 className="h-3.5 w-3.5" /> Undo exempt
                  </Button>
                )}
                {kind === "removed" && (
                  <Button size="sm" variant="outline" onClick={() => setPending({ kind: "restore", ids: [r.id], label: r.name })}>
                    <Undo2 className="h-3.5 w-3.5" /> Restore
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? TITLE[pending.kind](pending.label) : ""}
        description={pending ? DESCRIPTION[pending.kind] : undefined}
        confirmLabel={pending ? CONFIRM[pending.kind] : undefined}
        destructive={pending?.kind === "remove"}
        onConfirm={runPending}
      />
      <ExemptDialog
        target={exempt}
        onClose={() => setExempt(null)}
        onConfirm={(reason) => rpc("admin_set_exempt", { p_ids: exempt!.ids, p_exempt: true, p_reason: reason || null }, "Marked as exempt")}
      />
    </>
  );
}

const TITLE: Record<Pending["kind"], (who: string) => string> = {
  remove: (w) => `Remove ${w}?`,
  restore: (w) => `Restore ${w}?`,
  "undo-exempt": (w) => `Undo exemption for ${w}?`,
  "undo-mooc": (w) => `Undo MOOC choice for ${w}?`,
  reset: (w) => `Reset password for ${w}?`,
};
const DESCRIPTION: Record<Pending["kind"], string> = {
  remove:
    "For students who have left the college. Their login is disabled, any pending or accepted request is cancelled (the seat is freed), their batch is dissolved and they disappear from every list and count. You can restore them later from Settings.",
  restore: "The student can sign in again and appears in the lists as not opted. Their earlier requests are not brought back.",
  "undo-exempt": "The student returns to Not opted and can choose MOOC or Minor again.",
  "undo-mooc": "The student can then choose MOOC or Minor again.",
  reset: "The password goes back to the registration number and the student must choose a new one at next login.",
};
const CONFIRM: Record<Pending["kind"], string> = {
  remove: "Remove",
  restore: "Restore",
  "undo-exempt": "Undo exempt",
  "undo-mooc": "Undo choice",
  reset: "Reset password",
};

function ExemptDialog({ target, onClose, onConfirm }: { target: { ids: string[]; label: string } | null; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={`Exempt ${target?.label ?? ""}?`}
        description="For students who do not need to do MOOC or Minor. Both are locked in their portal, and they leave the Not Opted list."
        className="max-w-md"
      >
        <Field label="Reason (optional)" htmlFor="exempt-reason">
          <Input id="exempt-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
              } finally {
                setBusy(false);
                setReason("");
                onClose();
              }
            }}
          >
            Exempt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
