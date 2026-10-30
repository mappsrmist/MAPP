"use client";

import * as React from "react";
import { exportTable } from "@/lib/excel";
import {
  IMPORT_FIELDS, IMPORT_HEADERS, MAX_IMPORT_ROWS, buildImportRows, detectLayout, readImportWorkbook, validateImportFile,
  type ImportLayout, type ImportSheet,
} from "@/lib/import-excel";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Kind = "students" | "faculty" | "advisors";

const TEMPLATES: Record<Kind, { sample: string[]; note: string }> = {
  students: {
    sample: ["RA2411003010058", "Aarav Kumar", "CSE", "A", ""],
    note: "Reg No, Name and Section are needed; Dept and Email are optional (Dept defaults to the value you set below). New students sign in with their registration number as the password and must change it at first login.",
  },
  faculty: {
    sample: ["EMP1001", "Dr. Priya S", "priya@srmist.edu.in", "9876543210", "TP 801", "AI; Machine Learning", "OTHER"],
    note: "Emp ID, Name and SRM Email are needed. Cadre (HOD, Associate Chair or other) sets the seat and batch counts; it is read from a Cadre or Designation column (\"Professor & Head\" counts as HOD) and is OTHER when absent. Domains may be split by semicolons, commas or new lines, or spread over several columns. New faculty sign in with their SRM email as username and their employee ID as the password, and must change it at first login.",
  },
  advisors: {
    sample: ["EMP1001", "", "A"],
    note: "One row per section, identified by the advisor's Emp ID (import faculty first; their SRM email is already on file). A faculty member may appear on several rows. Unknown faculty, unknown sections and sections already assigned to someone else are reported per row. Re-uploading the same mapping changes nothing.",
  },
};

const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const CHUNK = 50;

interface RowError {
  row: number;
  message: string;
}

export function ImportClient({ initialKind = "students" }: { initialKind?: Kind }) {
  const [kind, setKind] = React.useState<Kind>(initialKind);
  const [sheets, setSheets] = React.useState<ImportSheet[] | null>(null);
  const [layout, setLayout] = React.useState<ImportLayout | null>(null);
  const [defaults, setDefaults] = React.useState<Record<string, string>>({});
  const [fileName, setFileName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [reading, setReading] = React.useState(false);
  const fileVersion = React.useRef(0);
  const [progress, setProgress] = React.useState(0);
  const [result, setResult] = React.useState<{ created: number; updated: number; errors: RowError[] } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const fields = IMPORT_FIELDS[kind];
  const built = React.useMemo(() => (sheets && layout ? buildImportRows(sheets, layout, kind, defaults) : null), [sheets, layout, kind, defaults]);
  const rows = built?.rows ?? null;
  const tooMany = (rows?.length ?? 0) > MAX_IMPORT_ROWS;

  function reset(next?: Kind) {
    fileVersion.current++;
    setReading(false);
    if (next) setKind(next);
    setSheets(null);
    setLayout(null);
    setDefaults({});
    setFileName("");
    setResult(null);
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function downloadTemplate() {
    const t = TEMPLATES[kind];
    const header = IMPORT_HEADERS[kind];
    try {
      await exportTable(`mapp_${kind}_template.xlsx`, kind, header.map((h) => ({ header: h, key: h, width: 24 })),
        [Object.fromEntries(header.map((h, i) => [h, t.sample[i]]))]);
    } catch { toast.error("Could not create the Excel template. Please try again."); }
  }

  async function onFile(file: File | undefined) {
    const version = ++fileVersion.current;
    setSheets(null);
    setLayout(null);
    setFileName("");
    setResult(null);
    if (!file) return;
    setReading(true);
    try {
      validateImportFile(file);
      const book = await readImportWorkbook(new Uint8Array(await file.arrayBuffer()));
      const found = detectLayout(book, kind);
      if (fileVersion.current !== version) return;
      setFileName(file.name);
      setSheets(book);
      setLayout(found);
    } catch (e) {
      if (fileVersion.current === version) toast.error(e instanceof Error ? e.message : "Could not read the Excel workbook.");
    } finally {
      if (fileVersion.current === version) setReading(false);
    }
  }

  function chooseSheet(index: number) {
    if (!sheets) return;
    try {
      setLayout(detectLayout(sheets, kind, index));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No matching columns on that sheet.");
    }
  }

  function chooseColumn(key: string, col: string) {
    if (!layout) return;
    // a column feeds one field: picking it here releases it elsewhere
    const mapping = Object.fromEntries(Object.entries(layout.mapping).map(([k, cols]) => [k, cols.filter((c) => String(c) !== col)]));
    mapping[key] = col === "" ? [] : [Number(col)];
    setLayout({ ...layout, mapping });
  }

  async function runImport() {
    if (!built || !rows) return;
    setBusy(true);
    setProgress(0);
    const totals = { created: 0, updated: 0, errors: [] as RowError[] };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await fetch("/api/admin/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: kind, offset: i, rows: rows.slice(i, i + CHUNK), rowNumbers: built.rowNumbers.slice(i, i + CHUNK) }),
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
          <p className="text-sm text-muted-foreground">
            Upload the sheet as you have it: title rows, extra columns, formulas, links and merged cells are fine. Columns are matched by their titles
            (for example {IMPORT_HEADERS[kind].join(", ")}), and you can correct the match before importing. Maximum 5 MiB and 5,000 rows.
          </p>
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
                {rows && <> · {rows.length} row(s) ready</>}
              </span>
            )}
          </div>

          {sheets && layout && built && (
            <div className="space-y-4 rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-semibold">Column matching</span>
                {sheets.filter((sh) => sh.rows.length).length > 1 ? (
                  <label className="inline-flex items-center gap-2">
                    Sheet
                    <Select className="h-9 w-auto" value={layout.sheetIndex} disabled={busy} onChange={(e) => chooseSheet(Number(e.target.value))}>
                      {sheets.map((sh, i) => (sh.rows.length ? <option key={i} value={i}>{sh.name}</option> : null))}
                    </Select>
                  </label>
                ) : (
                  <span className="text-muted-foreground">Sheet “{sheets[layout.sheetIndex].name}”</span>
                )}
                <span className="text-muted-foreground">Titles found on row {sheets[layout.sheetIndex].rows[layout.headerIndex].n}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-1.5 pr-3">MAPP field</th><th className="py-1.5 pr-3">Column in your file</th><th className="py-1.5">First value</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {fields.map((f) => {
                      const header = sheets[layout.sheetIndex].rows[layout.headerIndex].cells;
                      const cols = layout.mapping[f.key] ?? [];
                      const needsValue = !cols.length && f.fallback !== undefined;
                      return (
                        <tr key={f.key}>
                          <td className="py-2 pr-3 font-medium">
                            {f.label} {f.required && f.fallback === undefined && <span className="text-destructive" aria-label="required">*</span>}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Select className="h-9 w-56" aria-label={`Column for ${f.label}`} value={cols.length ? String(cols[0]) : ""} disabled={busy} onChange={(e) => chooseColumn(f.key, e.target.value)}>
                                <option value="">— Not in file —</option>
                                {header.map((h, i) => <option key={i} value={i}>{colName(i)}: {h || "(no title)"}</option>)}
                              </Select>
                              {cols.length > 1 && <Badge>+ {cols.slice(1).map((c) => header[c] || colName(c)).join(", ")}</Badge>}
                              {needsValue && (
                                <Input className="h-9 w-40" aria-label={`${f.label} for every row`} placeholder={f.fallback} value={defaults[f.key] ?? ""} disabled={busy}
                                  onChange={(e) => setDefaults((d) => ({ ...d, [f.key]: e.target.value }))} />
                              )}
                            </div>
                          </td>
                          <td className="max-w-56 truncate py-2 text-muted-foreground">{rows?.[0]?.[f.key] ?? ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {fields.some((f) => f.fallback !== undefined) && (
                <p className="text-xs text-muted-foreground">When a field is not in the file, the value in its box is used for every row ({fields.filter((f) => f.fallback !== undefined).map((f) => `${f.label}: ${f.fallback}`).join(", ")} if left empty).</p>
              )}
              {built.missing.length > 0 && (
                <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> Choose a column for: {built.missing.join(", ")}
                </p>
              )}
              {tooMany && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Import at most 5,000 rows at a time.</p>}
              {rows && rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-left uppercase text-muted-foreground">
                      <tr><th className="px-2 py-1.5">Row</th>{fields.map((f) => <th key={f.key} className="px-2 py-1.5">{f.label}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{built.rowNumbers[i]}</td>
                          {fields.map((f) => <td key={f.key} className="max-w-48 truncate px-2 py-1.5">{r[f.key] ?? ""}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 5 && <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">…and {rows.length - 5} more row(s)</p>}
                </div>
              )}
            </div>
          )}

          {busy && (
            <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          <Button disabled={reading || !rows || rows.length === 0 || !!built?.missing.length || tooMany} loading={busy || reading} onClick={runImport}>
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
