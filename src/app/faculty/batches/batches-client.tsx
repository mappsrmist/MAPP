"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Download, Pencil, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PagedTable } from "@/components/paged-table";
import { batchesForCadre, MSG, PAGE_SIZE } from "@/lib/config";
import { BATCH_COLUMNS, buildSheetRows, fillForBatch, guideTitle } from "@/lib/batch-sheet";
import { exportBatchSheet, safeFilePart } from "@/lib/excel";
import { createClient } from "@/lib/supabase/client";
import type { ApplicationLite } from "@/lib/batch-sheet";
import type { BatchRow, RequestDetail } from "@/lib/types";
import { useFaculty } from "../faculty-context";
const BatchFormDialog = dynamic(() => import("./batch-form").then((mod) => mod.BatchFormDialog), {
  loading: () => <p role="status" className="mt-4 text-sm text-muted-foreground">Loading batch editor…</p>,
});

export function BatchesClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const { faculty, tick, bump, frozen, formed } = useFaculty();
  const [accepted, setAccepted] = React.useState<RequestDetail[]>([]);
  const [batches, setBatches] = React.useState<BatchRow[]>([]);
  const [apps, setApps] = React.useState<ApplicationLite[]>([]);
  const [version, setVersion] = React.useState(0);
  const [editing, setEditing] = React.useState<number | null>(null);
  const [ungroup, setUngroup] = React.useState<BatchRow | null>(null);

  const load = React.useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from("request_details_v").select("*").eq("faculty_id", faculty.id).eq("status", "accepted").order("student_name").limit(1000),
      supabase.from("batches").select("*, batch_members(slot, student_id, section, advisor_name, contact_number, srm_mail)").eq("faculty_id", faculty.id).order("batch_no"),
      supabase.from("applications").select("student1_id, student2_id, student1_mobile, student2_mobile, project_title").eq("faculty_id", faculty.id),
    ]);
    if (a.error || b.error || c.error) return toast.error((a.error ?? b.error ?? c.error)!.message);
    setApps(c.data as ApplicationLite[]);
    setAccepted(a.data as RequestDetail[]);
    setBatches(b.data as BatchRow[]);
    setVersion((v) => v + 1);
  }, [supabase, faculty.id]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, tick]);

  const students = React.useMemo(() => Object.fromEntries(accepted.map((s) => [s.student_id, { name: s.student_name, reg_no: s.reg_no }])), [accepted]);
  const sheet = React.useMemo(() => buildSheetRows(batches, students, faculty.name, { applications: apps }), [batches, students, faculty.name, apps]);
  const guide = { name: faculty.name, empId: faculty.emp_id };
  const count = batchesForCadre(faculty.cadre);
  const byNo = new Map(batches.map((b) => [b.batch_no, b]));
  const placed = new Set(batches.flatMap((b) => b.batch_members.map((m) => m.student_id)));
  const batchOf = new Map(batches.flatMap((b) => b.batch_members.map((m) => [m.student_id, b.batch_no] as const)));

  return (
    <>
      <PageHeader
        title="Batch Grouping"
        description={`Group your accepted students into batches of two. ${count - formed} of ${count} batches remaining.`}
      />

      <section aria-label="Batches" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
          const b = byNo.get(n);
          const members = b ? [...b.batch_members].sort((x, y) => x.slot - y.slot) : [];
          const grouped = members.length === 2;
          return (
            <div key={n} className="flex flex-col rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between rounded-t-xl px-4 py-2.5 text-sm font-semibold text-slate-800" style={{ background: `#${fillForBatch(n)}` }}>
                <span>Batch {n}</span>
                <Badge tone={grouped ? "success" : "neutral"}>{grouped ? "Grouped" : "Empty"}</Badge>
              </div>
              <div className="min-h-20 flex-1 space-y-1 p-4 text-sm">
                {members.length ? (
                  members.map((m) => (
                    <p key={m.slot}>
                      <span className="font-medium">{students[m.student_id]?.name ?? "—"}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {students[m.student_id]?.reg_no} · {m.section}
                      </span>
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground">Not grouped yet.</p>
                )}
              </div>
              <div className="flex gap-2 border-t p-3">
                {b ? (
                  <>
                    <Button size="sm" variant="outline" disabled={frozen} title={frozen ? MSG.FROZEN_TIP : undefined} onClick={() => setEditing(n)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="destructive" disabled={frozen} title={frozen ? MSG.FROZEN_TIP : undefined} onClick={() => setUngroup(b)}>
                      <Undo2 className="h-3.5 w-3.5" /> Ungroup
                    </Button>
                  </>
                ) : (
                  <Button size="sm" disabled={frozen} title={frozen ? MSG.FROZEN_TIP : undefined} onClick={() => setEditing(n)}>
                    <Plus className="h-3.5 w-3.5" /> Group
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <Card className="mt-8">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Final sheet</CardTitle>
            <CardDescription>{guideTitle(guide)}</CardDescription>
          </div>
          <Button disabled={sheet.length === 0} onClick={() => exportBatchSheet(`MAPP_${safeFilePart(faculty.name)}_Batches.xlsx`, sheet, guide).then(() => toast.success("Excel downloaded"))}>
            <Download className="h-4 w-4" />
            Download Excel
          </Button>
        </CardHeader>
        <CardContent>
          {sheet.length === 0 ? (
            <EmptyState title="No batches grouped yet" hint="Group students above and the sheet appears here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {BATCH_COLUMNS.map((h) => (
                      <th key={h} scope="col" className="border border-slate-400/60 px-3 py-2 text-left font-bold text-slate-800" style={{ background: "#BDD7EE" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.map((r, i) => (
                    <tr key={i}>
                      {r.first && (
                        <td rowSpan={2} className="border border-slate-400/60 px-3 py-2 text-center align-middle font-bold text-slate-800" style={{ background: `#${fillForBatch(r.batchNo)}` }}>
                          {r.batchLabel}
                        </td>
                      )}
                      <td className="border border-slate-400/60 px-3 py-2">{r.name}</td>
                      <td className="border border-slate-400/60 px-3 py-2 font-mono text-xs">{r.regNo}</td>
                      <td className="border border-slate-400/60 px-3 py-2">{r.section}</td>
                      <td className="border border-slate-400/60 px-3 py-2">{r.advisor}</td>
                      <td className="border border-slate-400/60 px-3 py-2">{r.phone}</td>
                      <td className="border border-slate-400/60 px-3 py-2">{r.mail}</td>
                      <td className="border border-slate-400/60 px-3 py-2">{r.studentMobile}</td>
                      {(r.first || sheet[i - 1]?.projectTitle !== r.projectTitle) && (
                        <td rowSpan={r.first && sheet[i + 1]?.projectTitle === r.projectTitle ? 2 : 1} className="border border-slate-400/60 px-3 py-2 align-middle">
                          {r.projectTitle}
                        </td>
                      )}
                      <td className="border border-slate-400/60 px-3 py-2">{r.guideName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">All accepted students</h2>
      <PagedTable<RequestDetail>
        rowKey={(r) => r.student_id}
        searchPlaceholder="Search by registration number or name"
        refreshKey={version}
        emptyTitle="No accepted students yet"
        emptyHint="Accept requests under Students Approached first."
        fetchPage={async (page, search) => {
          const q = search.trim().toLowerCase();
          const rows = accepted.filter((s) => !q || s.reg_no.toLowerCase().includes(q) || s.student_name.toLowerCase().includes(q));
          return { rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: rows.length };
        }}
        columns={[
          { header: "Reg No", cell: (r) => <span className="font-mono text-xs">{r.reg_no}</span> },
          { header: "Name", cell: (r) => <span className="font-medium">{r.student_name}</span> },
          { header: "Section", cell: (r) => r.student_section ?? "—" },
          {
            header: "Batch",
            cell: (r) => (batchOf.has(r.student_id) ? <Badge tone="info">Batch {batchOf.get(r.student_id)}</Badge> : <Badge>Unassigned</Badge>),
          },
        ]}
      />

      {editing !== null && (
        <BatchFormDialog
          key={editing}
          batchNo={editing}
          existing={byNo.get(editing) ?? null}
          options={accepted.filter((s) => !placed.has(s.student_id) || byNo.get(editing)?.batch_members.some((m) => m.student_id === s.student_id))}
          faculty={faculty}
          frozen={frozen}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      <ConfirmDialog
        open={ungroup !== null}
        onOpenChange={(o) => !o && setUngroup(null)}
        title={`Ungroup Batch ${ungroup?.batch_no}?`}
        description="Both students go back to the unassigned list and the batch details are cleared. They stay accepted and keep their seats."
        confirmLabel="Ungroup"
        destructive
        onConfirm={async () => {
          const { error } = await supabase.rpc("ungroup_batch", { p_batch_id: ungroup!.id });
          if (error) toast.error(error.message);
          else toast.success(`Batch ${ungroup!.batch_no} ungrouped`);
          bump();
        }}
      />
    </>
  );
}
