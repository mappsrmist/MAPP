"use client";

import * as React from "react";
import Link from "next/link";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { PagedTable } from "@/components/paged-table";
import { exportTable } from "@/lib/excel";
import { cleanSearch } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { AdvisorRow, SectionRow } from "@/lib/types";

/** Admin -> Faculty Advisors: map each section (class) to its Faculty Advisor. */
export function AdvisorsClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const [sections, setSections] = React.useState<SectionRow[]>([]);
  const [empId, setEmpId] = React.useState("");
  const [section, setSection] = React.useState("");
  const [match, setMatch] = React.useState<{ name: string } | "none" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [replace, setReplace] = React.useState<{ empId: string; section: string; current: string } | null>(null);
  const [edit, setEdit] = React.useState<AdvisorRow | null>(null);
  const [remove, setRemove] = React.useState<AdvisorRow | null>(null);

  React.useEffect(() => {
    void supabase.rpc("admin_sections").then(({ data }) => setSections((data ?? []) as SectionRow[]));
  }, [supabase, refresh]);

  // show the faculty name as soon as the employee ID matches
  React.useEffect(() => {
    const id = empId.trim();
    let live = true;
    const t = setTimeout(async () => {
      if (!id) return void (live && setMatch(null));
      const { data } = await supabase.from("faculty").select("name").ilike("emp_id", cleanSearch(id)).limit(1).maybeSingle();
      if (live) setMatch(data ? { name: data.name } : "none");
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [supabase, empId]);

  async function assign(emp: string, sec: string, doReplace: boolean) {
    const { data, error } = await supabase.rpc("admin_set_fa", { p_emp_id: emp, p_section: sec, p_replace: doReplace });
    if (error) {
      const already = /already assigned to (.+)\.$/.exec(error.message);
      if (already && !doReplace) setReplace({ empId: emp, section: sec, current: already[1] });
      else toast.error(error.message);
      return false;
    }
    toast.success(data === "unchanged" ? "Already assigned" : data === "replaced" ? "Faculty Advisor replaced" : "Faculty Advisor added");
    setRefresh((n) => n + 1);
    return true;
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (await assign(empId, section, false)) {
        setEmpId("");
        setSection("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function exportList() {
    const { data, error } = await supabase.rpc("admin_list_advisors", { p_search: null, p_page: 0 });
    if (error) return void toast.error(error.message);
    await exportTable("MAPP_Faculty_Advisors.xlsx", "Faculty Advisors", [
      { header: "Section", key: "s", width: 12 },
      { header: "FA Emp ID", key: "e", width: 16 },
      { header: "FA Name", key: "n", width: 30 },
      { header: "Students in section", key: "c", width: 20 },
    ], ((data ?? []) as AdvisorRow[]).map((r) => ({ s: r.section, e: r.fa_emp_id, n: r.fa_name, c: r.student_count })));
  }

  return (
    <>
      <PageHeader
        title="Faculty Advisors"
        description="Each section (class) has one Faculty Advisor; an advisor may own several sections. The mapping fills the advisor name in Batch Grouping and the Excel sheets."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportList()}>
              <Download className="h-4 w-4" /> Excel
            </Button>
            <Link href="/admin/import?tab=advisors" className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" /> Import from Excel
            </Link>
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a Faculty Advisor</CardTitle>
          <CardDescription>Enter the faculty member&apos;s employee ID and the section they advise.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Employee ID" htmlFor="fa-emp">
              <Input id="fa-emp" value={empId} onChange={(e) => setEmpId(e.target.value)} required maxLength={40} autoComplete="off" />
              <p className="mt-1 h-4 text-xs text-muted-foreground" aria-live="polite">
                {match === "none" ? <span className="text-destructive">No faculty with this employee ID</span> : match ? `Faculty: ${match.name}` : ""}
              </p>
            </Field>
            <Field label="Section" htmlFor="fa-section">
              <Select id="fa-section" value={section} onChange={(e) => setSection(e.target.value)} required>
                <option value="">Select a section…</option>
                {sections.map((s) => (
                  <option key={s.section} value={s.section}>
                    {s.section} — {s.fa_name ? `advisor: ${s.fa_name}` : "no advisor"} ({s.student_count})
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={busy} disabled={!empId.trim() || !section || match === "none"}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <PagedTable<AdvisorRow>
        rowKey={(r) => r.section}
        refreshKey={refresh}
        searchPlaceholder="Search by section, employee ID or name"
        emptyTitle="No Faculty Advisors yet"
        emptyHint="Add one above or import an Excel sheet."
        onError={(m) => toast.error(m)}
        fetchPage={async (page, search) => {
          const { data, error } = await supabase.rpc("admin_list_advisors", { p_search: search || null, p_page: page });
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as AdvisorRow[];
          return { rows, total: Number(rows[0]?.total_count ?? 0) };
        }}
        columns={[
          { header: "Section", cell: (r) => <span className="font-medium">{r.section}</span> },
          { header: "FA Emp ID", cell: (r) => <span className="font-mono text-xs">{r.fa_emp_id}</span> },
          { header: "FA Name", cell: (r) => r.fa_name },
          { header: "Students in section", cell: (r) => r.student_count },
          {
            header: "Edit",
            cell: (r) => (
              <Button size="sm" variant="outline" onClick={() => setEdit(r)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            ),
          },
          {
            header: "Remove",
            cell: (r) => (
              <Button size="sm" variant="destructive" onClick={() => setRemove(r)}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={!!replace}
        onOpenChange={(o) => !o && setReplace(null)}
        title={`Replace the advisor of section ${replace?.section}?`}
        description={`Section ${replace?.section} is already assigned to ${replace?.current}. Replace them with employee ${replace?.empId}?`}
        confirmLabel="Replace"
        destructive
        onConfirm={async () => {
          await assign(replace!.empId, replace!.section, true);
          setEmpId("");
          setSection("");
        }}
      />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={`Remove the advisor of section ${remove?.section}?`}
        description="The section will have no Faculty Advisor until another is assigned. Existing batch sheets keep the names already saved."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const { error } = await supabase.rpc("admin_remove_fa", { p_section: remove!.section });
          if (error) toast.error(error.message);
          else toast.success("Faculty Advisor removed");
          setRefresh((n) => n + 1);
        }}
      />
      {edit && <EditDialog
        row={edit}
        onClose={() => setEdit(null)}
        onSave={async (emp) => {
          return assign(emp, edit.section, true);
        }}
      />}
    </>
  );
}

function EditDialog({ row, onClose, onSave }: { row: AdvisorRow; onClose: () => void; onSave: (empId: string) => Promise<boolean> }) {
  const [value, setValue] = React.useState(row.fa_emp_id);
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={`Edit section ${row?.section ?? ""}`} description="Assign a different Faculty Advisor by employee ID." className="max-w-sm">
        <Field label="Employee ID" htmlFor="fa-edit-emp">
          <Input id="fa-edit-emp" value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} />
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
                if (await onSave(value)) onClose();
              } finally {
                setBusy(false);
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
