"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Badge, PageHeader, StatusBadge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { PagedTable } from "@/components/paged-table";
import { guideTitle, sheetsFromDetails } from "@/lib/batch-sheet";
import { PAGE_SIZE } from "@/lib/config";
import { exportBatchWorkbook, exportTable } from "@/lib/excel";
import { fetchAll } from "@/lib/fetch-all";
import { cleanSearch, useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { RequestDetail } from "@/lib/types";

type Action = "section" | "move" | "remove" | "reset";
const STATUSES = ["pending", "accepted", "grouped", "declined"] as const;

interface FacultyOption {
  id: string;
  name: string;
  emp_id: string;
  available_seats: number;
}

const ACTIONS: { value: Action; label: string; when: (r: RequestDetail) => boolean }[] = [
  { value: "section", label: "Edit section", when: () => true },
  { value: "move", label: "Move to another faculty", when: (r) => r.status === "accepted" },
  { value: "remove", label: "Remove from faculty", when: (r) => r.status === "accepted" },
  { value: "reset", label: "Reset status to Pending", when: (r) => r.status !== "pending" },
];

export function AllocationsClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const [refresh, setRefresh] = React.useState(0);
  const [faculty, setFaculty] = React.useState<FacultyOption[]>([]);
  const [facultyId, setFacultyId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [section, setSection] = React.useState("");
  const [pending, setPending] = React.useState<{ row: RequestDetail; action: Action } | null>(null);

  const loadFaculty = React.useCallback(async () => {
    const { data } = await supabase.from("faculty").select("id, name, emp_id, available_seats").order("name").limit(1000);
    setFaculty((data ?? []) as FacultyOption[]);
  }, [supabase]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFaculty();
  }, [loadFaculty, refresh]);

  useRealtime([{ table: "requests" }, { table: "batches" }, { table: "batch_members" }, { table: "faculty" }], () => setRefresh((n) => n + 1));

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(fn, args);
    if (error) toast.error(error.message);
    else toast.success(ok);
    setRefresh((n) => n + 1);
  }

  const run = (p: Promise<void>) => p.then(() => toast.success("Excel downloaded")).catch((e) => toast.error(e instanceof Error ? e.message : "Export failed"));

  async function exportList() {
    const rows = await fetchAll<RequestDetail>((f, t) =>
      supabase.from("request_details_v").select("*").order("faculty_emp_id").order("batch_no", { nullsFirst: false }).order("slot").order("reg_no").range(f, t),
    );
    // same order as the on-screen table: guide first (Emp ID, name), then the student and their batch details
    await exportTable("MAPP_Allocations_List.xlsx", "Allocations", [
      { header: "Guide Emp ID", key: "fe", width: 16 },
      { header: "Guide Name", key: "fn", width: 28 },
      { header: "Batch", key: "b", width: 10 },
      { header: "Registration No.", key: "r", width: 22 },
      { header: "Student", key: "s", width: 28 },
      { header: "Section", key: "sec", width: 10 },
      { header: "Faculty Advisor Name", key: "fa", width: 28 },
      { header: "Project Title", key: "pt", width: 36 },
      { header: "Student Mail ID", key: "m", width: 34 },
      { header: "Status", key: "st", width: 12 },
    ], rows.map((r) => ({ fe: r.faculty_emp_id, fn: r.faculty_name, b: r.batch_no ? `B${r.batch_no}` : "", r: r.reg_no, s: r.student_name, sec: r.section ?? "", fa: r.advisor_name ?? r.fa_name ?? "", pt: r.project_title ?? "", m: r.student_email ?? r.srm_mail ?? "", st: r.display_status })));
  }

  /** All allocations in the faculty batch-sheet template: a combined sheet plus one sheet per faculty. */
  async function exportTemplate() {
    const rows = await fetchAll<RequestDetail>((f, t) =>
      supabase.from("request_details_v").select("*").eq("status", "accepted").not("batch_id", "is", null).order("faculty_emp_id").order("batch_no").order("slot").range(f, t),
    );
    const sheets = sheetsFromDetails(rows);
    if (sheets.length === 0) throw new Error("No grouped batches to export yet.");
    await exportBatchWorkbook("MAPP_All_Allocations.xlsx", [
      { name: "All allocations", title: `All allocations — ${sheets.length} guide${sheets.length === 1 ? "" : "s"}`, rows: sheets.flatMap((s) => s.rows), leadEmpId: true },
      ...sheets.map((s) => ({ name: `${s.guide.empId} ${s.guide.name}`, title: guideTitle(s.guide), rows: s.rows, leadEmpId: true })),
    ]);
  }

  return (
    <>
      <PageHeader
        title="Allocations"
        description="Every request and its outcome. Admin actions work even while allocations are frozen and are written to the audit log."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => run(exportList())}>
              <Download className="h-4 w-4" /> Table (Excel)
            </Button>
            <Button size="sm" onClick={() => run(exportTemplate())}>
              <Download className="h-4 w-4" /> All allocations (template)
            </Button>
          </div>
        }
      />
      <PagedTable<RequestDetail>
        rowKey={(r) => r.id}
        refreshKey={refresh}
        deps={[facultyId, status, section]}
        searchPlaceholder="Search by registration number or name"
        emptyTitle="No allocations match"
        emptyHint="Try clearing the filters."
        onError={(m) => toast.error(m)}
        toolbar={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select aria-label="Filter by faculty" value={facultyId} onChange={(e) => setFacultyId(e.target.value)} className="sm:w-56">
              <option value="">All faculty</option>
              {faculty.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.emp_id})
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
            <Input aria-label="Filter by section" placeholder="Section" value={section} onChange={(e) => setSection(e.target.value)} className="sm:w-28" />
          </div>
        }
        fetchPage={async (page, search, signal) => {
          let q = supabase
            .from("request_details_v")
            .select("*", { count: "exact" })
            .order("faculty_emp_id")
            .order("batch_no", { nullsFirst: false })
            .order("slot", { nullsFirst: false })
            .order("reg_no")
            .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
          if (facultyId) q = q.eq("faculty_id", facultyId);
          if (status) q = q.eq("display_status", status);
          const sec = cleanSearch(section);
          if (sec) q = q.ilike("section", sec);
          const term = cleanSearch(search);
          if (term) q = q.or(`reg_no.ilike.%${term}%,student_name.ilike.%${term}%`);
          const { data, count, error } = await q.abortSignal(signal);
          if (error) throw new Error(error.message);
          return { rows: (data ?? []) as RequestDetail[], total: count ?? 0 };
        }}
        columns={[
          { header: "Guide Emp ID", cell: (r) => <span className="font-mono text-xs">{r.faculty_emp_id}</span> },
          { header: "Guide Name", cell: (r) => <span className="font-medium">{r.faculty_name}</span> },
          { header: "Batch", cell: (r) => (r.batch_no ? <Badge tone="info">B{r.batch_no}</Badge> : <span className="text-muted-foreground">—</span>) },
          { header: "Reg No", cell: (r) => <span className="font-mono text-xs">{r.reg_no}</span> },
          { header: "Student", cell: (r) => <span className="font-medium">{r.student_name}</span> },
          { header: "Section", cell: (r) => r.section ?? "—" },
          { header: "Faculty Advisor Name", cell: (r) => r.advisor_name ?? r.fa_name ?? "—" },
          { header: "Project Title", cell: (r) => r.project_title ?? "—" },
          { header: "Student Mail ID", cell: (r) => r.student_email ?? r.srm_mail ?? "—" },
          { header: "Status", cell: (r) => <StatusBadge status={r.display_status} /> },
          {
            header: "Action",
            cell: (r) => (
              <Select
                aria-label={`Actions for ${r.student_name}`}
                value=""
                className="h-8 w-40 text-xs"
                onChange={(e) => e.target.value && setPending({ row: r, action: e.target.value as Action })}
              >
                <option value="">Actions…</option>
                {ACTIONS.filter((a) => a.when(r)).map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            ),
          },
        ]}
      />

      <SectionDialog
        row={pending?.action === "section" ? pending.row : null}
        onClose={() => setPending(null)}
        onSave={(r, v) => rpc("admin_set_section", { p_student: r.student_id, p_section: v }, "Section updated")}
      />
      <MoveDialog
        row={pending?.action === "move" ? pending.row : null}
        faculty={faculty}
        onClose={() => setPending(null)}
        onMove={(r, to) => rpc("admin_move_student", { p_request_id: r.id, p_to_faculty: to }, "Student moved")}
      />
      <ConfirmDialog
        open={pending?.action === "remove" || pending?.action === "reset"}
        onOpenChange={(o) => !o && setPending(null)}
        title={
          pending?.action === "remove"
            ? `Remove ${pending.row.student_name} from ${pending.row.faculty_name}?`
            : `Reset ${pending?.row.student_name} to Pending?`
        }
        description={
          pending?.action === "remove"
            ? "This frees the faculty's seat, dissolves their batch and application, and unlocks the student's Minor portal."
            : pending?.row.status === "accepted"
              ? "The seat is freed and their batch and application are dissolved. The request goes back to the faculty as Pending."
              : "The declined request goes back to the faculty as Pending and the student's Minor portal locks again."
        }
        confirmLabel={pending?.action === "remove" ? "Remove" : "Reset"}
        destructive
        onConfirm={() => {
          const p = pending!;
          return p.action === "remove"
            ? rpc("admin_remove_accepted", { p_request_id: p.row.id }, "Allocation removed")
            : rpc("admin_reset_request", { p_request_id: p.row.id }, "Status reset to Pending");
        }}
      />
    </>
  );
}

function SectionDialog({ row, onClose, onSave }: { row: RequestDetail | null; onClose: () => void; onSave: (r: RequestDetail, v: string) => Promise<void> }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [lastId, setLastId] = React.useState<string | null>(null);
  if (row && row.id !== lastId) {
    setLastId(row.id);
    setValue(row.section ?? "");
  }
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title="Edit section" description={row ? `${row.student_name} (${row.reg_no})` : undefined} className="max-w-sm">
        <Field label="Section" htmlFor="alloc-section">
          <Input id="alloc-section" value={value} maxLength={20} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!value.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(row!, value);
              } finally {
                setBusy(false);
                onClose();
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  row,
  faculty,
  onClose,
  onMove,
}: {
  row: RequestDetail | null;
  faculty: FacultyOption[];
  onClose: () => void;
  onMove: (r: RequestDetail, to: string) => Promise<void>;
}) {
  const [to, setTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const options = faculty.filter((f) => f.id !== row?.faculty_id && f.available_seats > 0);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title="Move to another faculty"
        description={row ? `${row.student_name} (${row.reg_no}) leaves ${row.faculty_name}. Their batch and application are dissolved.` : undefined}
        className="max-w-md"
      >
        <Field label="New faculty (only those with free seats)" htmlFor="alloc-move">
          <Select id="alloc-move" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Select a faculty…</option>
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.emp_id}) — {f.available_seats} free
              </option>
            ))}
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!to}
            onClick={async () => {
              setBusy(true);
              try {
                await onMove(row!, to);
              } finally {
                setBusy(false);
                setTo("");
                onClose();
              }
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
