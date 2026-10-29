"use client";

import * as React from "react";
import { exportTable } from "@/lib/excel";
import { IMPORT_HEADERS, parseImportWorkbook, validateImportFile } from "@/lib/import-excel";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Kind = "students" | "faculty" | "advisors";

const TEMPLATES: Record<Kind, { header: string[]; sample: string[]; note: string }> = {
  students: {
    header: IMPORT_HEADERS.students,
    sample: ["RA2411003010058", "Aarav Kumar", "CSE", "A", ""],
    note: "section is required (it appears on the Approached list and the Excel sheets); email is optional. New students sign in with their registration number as the password and must change it at first login.",
  },
  faculty: {
    header: IMPORT_HEADERS.faculty,
    sample: ["EMP1001", "Dr. Priya S", "priya@srmist.edu.in", "9876543210", "TP 801", "AI;Machine Learning", "OTHER", "Assistant Professor"],
    note: "designation: optional academic title, shown on application forms. cadre: HOD, ASSOC_CHAIR or OTHER (it sets the seat and batch counts and is never shown). domains: separate with semicolons. New faculty sign in with their SRM email as username and their employee ID as the password, and must change it at first login.",
  },
  advisors: {
    header: IMPORT_HEADERS.advisors,
    sample: ["EMP1001", "A"],
    note: "One row per section; a faculty member may appear on several rows. Unknown employee IDs, unknown sections and sections already assigned to someone else are reported per row. Re-uploading the same mapping changes nothing.",
  },
};

const CHUNK = 50;

interface RowError {
  row: number;
  message: string;
}

export function ImportClient({ initialKind = "students" }: { initialKind?: Kind }) {
  const [kind, setKind] = React.useState<Kind>(initialKind);
  const [rows, setRows] = React.useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [reading, setReading] = React.useState(false);
  const fileVersion = React.useRef(0);
  const [progress, setProgress] = React.useState(0);
  const [result, setResult] = React.useState<{ created: number; updated: number; errors: RowError[] } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function reset(next?: Kind) {
    fileVersion.current++;
    setReading(false);
    if (next) setKind(next);
    setRows(null);
    setFileName("");
    setResult(null);
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function downloadTemplate() {
    const t = TEMPLATES[kind];
    try {
      await exportTable(`mapp_${kind}_template.xlsx`, kind, t.header.map((h) => ({ header: h, key: h, width: 24 })),
        [Object.fromEntries(t.header.map((h, i) => [h, t.sample[i]]))]);
    } catch { toast.error("Could not create the Excel template. Please try again."); }
  }

  async function onFile(file: File | undefined) {
    const version = ++fileVersion.current;
    setRows(null);
    setFileName("");
    setResult(null);
    if (!file) return;
    setReading(true);
    try {
      validateImportFile(file);
      const data = await parseImportWorkbook(new Uint8Array(await file.arrayBuffer()), kind);
      if (fileVersion.current !== version) return;
      setFileName(file.name);
      setRows(data);
    } catch (e) {
      if (fileVersion.current === version) toast.error(e instanceof Error ? e.message : "Could not read the Excel workbook.");
    } finally {
      if (fileVersion.current === version) setReading(false);
    }
  }

  async function runImport() {
    if (!rows) return;
    setBusy(true);
    setProgress(0);
    const totals = { created: 0, updated: 0, errors: [] as RowError[] };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await fetch("/api/admin/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: kind, offset: i, rows: rows.slice(i, i + CHUNK) }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`);
        totals.created += json.created;
        totals.updated += json.updated;
        totals.errors.push(...json.errors);
        setProgress(Math.min(100, Math.round(((i + CHUNK) / rows.length) * 100)));
      }
      setResult(totals);
      if (totals.errors.length) toast.warning(`Imported with ${totals.errors.length} row error(s)`);
      else toast.success("Import complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function downloadErrors() {
    if (!result) return;
    try {
      await exportTable("import_errors.xlsx", "Errors", [{ header: "row", key: "row", width: 12 }, { header: "error", key: "error", width: 90 }],
        result.errors.map((e) => ({ row: e.row, error: e.message })));
    } catch { toast.error("Could not create the Excel error report. Please try again."); }
  }

  const t = TEMPLATES[kind];

  return (
    <>
      <PageHeader title="Import data" description="Upload an Excel (.xlsx) workbook to create or update students and faculty, or to map sections to their Faculty Advisors. Re-uploading updates existing users without duplicating them." />

      <div role="tablist" aria-label="Import type" className="mb-4 inline-flex gap-1 rounded-xl bg-muted p-1">
        {(["students", "faculty", "advisors"] as Kind[]).map((k) => (
          <button key={k} disabled={busy || reading} role="tab" aria-selected={kind === k} onClick={() => reset(k)} className={cn("cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium capitalize", kind === k ? "bg-card shadow-sm" : "text-muted-foreground")}>
            {k === "advisors" ? "Faculty Advisors" : k}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
            <CardTitle className="capitalize">{kind === "advisors" ? "Faculty Advisors" : kind} Excel workbook</CardTitle>
          <CardDescription>{t.note}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">{t.header.join(", ")}</p>
          <p className="text-sm text-muted-foreground">Use one worksheet with headers in the first row. Maximum 2 MiB and 5,000 data rows. Keep IDs and phone numbers as text. Formulas, macros and embedded objects are not accepted.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download template
            </Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" />
              Choose Excel file
              <input ref={fileRef} disabled={busy || reading} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            {fileName && (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" /> {fileName}
                {rows && <> · {rows.length} row(s)</>}
              </span>
            )}
          </div>

          {busy && (
            <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          <Button disabled={reading || !rows || rows.length === 0} loading={busy || reading} onClick={runImport}>
            Import {rows ? rows.length : ""} {kind === "advisors" ? "mapping(s)" : kind}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Import result
            </CardTitle>
            <CardDescription>
              {result.created} {kind === "advisors" ? "added" : "created"} · {result.updated} {kind === "advisors" ? "unchanged" : "updated"} · {result.errors.length} error(s)
            </CardDescription>
          </CardHeader>
          {result.errors.length > 0 && (
            <CardContent>
              <div className="mb-2 flex justify-end">
                <Button size="sm" variant="outline" onClick={downloadErrors}>
                  <Download className="h-3.5 w-3.5" /> Download error report
                </Button>
              </div>
              <div className="max-h-80 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Problem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.errors.map((e) => (
                      <tr key={e.row}>
                        <td className="px-3 py-2 tabular-nums">{e.row}</td>
                        <td className="px-3 py-2 text-destructive">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </>
  );
}
