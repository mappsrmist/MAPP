"use client";

import * as React from "react";
import Papa from "papaparse";
import { CheckCircle2, Download, FileSpreadsheet, KeyRound, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Kind = "students" | "faculty";

const TEMPLATES: Record<Kind, { header: string[]; sample: string[]; note: string }> = {
  students: {
    header: ["reg_no", "name", "dept", "section", "email"],
    sample: ["RA2411003010058", "Aarav Kumar", "CSE", "A", ""],
    note: "section and email are optional. Each new student gets a random one-time password; download the credentials sheet after the import.",
  },
  faculty: {
    header: ["emp_id", "name", "srm_email", "designation", "cadre", "phone", "venue", "domains"],
    sample: ["E1001", "Dr. Priya S", "priya@srmist.edu.in", "Professor", "OTHER", "9876543210", "TP 801", "AI;Machine Learning"],
    note: "cadre: HOD, ASSOC_CHAIR or OTHER. domains: separate with semicolons. Each new faculty member gets a random one-time password; download the credentials sheet after the import.",
  },
};

const CHUNK = 50;

interface RowError {
  row: number;
  message: string;
}

interface Credential {
  username: string;
  name: string;
  password: string;
}

export function ImportClient() {
  const [kind, setKind] = React.useState<Kind>("students");
  const [rows, setRows] = React.useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [result, setResult] = React.useState<{ created: number; updated: number; errors: RowError[] } | null>(null);
  // One-time passwords live only in this component's memory: never stored, gone when the page closes.
  const [credentials, setCredentials] = React.useState<Credential[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function reset(next?: Kind) {
    if (next) setKind(next);
    setRows(null);
    setFileName("");
    setResult(null);
    setCredentials([]);
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadTemplate() {
    const t = TEMPLATES[kind];
    const csv = Papa.unparse([t.header, t.sample]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `mapp_${kind}_template.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(file: File | undefined) {
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase(),
      transform: (v) => (typeof v === "string" ? v.trim() : v),
      complete: (res) => {
        const missing = TEMPLATES[kind].header.filter((h) => !(res.meta.fields ?? []).includes(h) && !["section", "email", "phone", "venue", "domains"].includes(h));
        if (missing.length) {
          toast.error(`Missing column(s): ${missing.join(", ")}`);
          return setRows(null);
        }
        setRows(res.data);
      },
      error: (e) => toast.error(e.message),
    });
  }

  async function runImport() {
    if (!rows) return;
    setBusy(true);
    setProgress(0);
    const totals = { created: 0, updated: 0, errors: [] as RowError[] };
    const issued: Credential[] = [];
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
        issued.push(...(json.credentials ?? []));
        setProgress(Math.min(100, Math.round(((i + CHUNK) / rows.length) * 100)));
      }
      setResult(totals);
      setCredentials(issued);
      if (totals.errors.length) toast.warning(`Imported with ${totals.errors.length} row error(s)`);
      else toast.success("Import complete");
    } catch (e) {
      // rows imported before the failure already have accounts: keep their passwords downloadable
      setCredentials(issued);
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    if (!result) return;
    const csv = Papa.unparse(result.errors.map((e) => ({ row: e.row, error: e.message })), { escapeFormulae: true });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "import_errors.csv" }).click();
    URL.revokeObjectURL(url);
  }

  function downloadCredentials() {
    const csv = Papa.unparse(credentials, { escapeFormulae: true });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `mapp_${kind}_credentials.csv` }).click();
    URL.revokeObjectURL(url);
  }

  const t = TEMPLATES[kind];

  return (
    <>
      <PageHeader title="Import data" description="Upload a CSV to create or update students and faculty. Re-uploading is safe: existing users are updated, not duplicated." />

      <div role="tablist" aria-label="Import type" className="mb-4 inline-flex gap-1 rounded-xl bg-muted p-1">
        {(["students", "faculty"] as Kind[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => reset(k)} className={cn("cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium capitalize", kind === k ? "bg-card shadow-sm" : "text-muted-foreground")}>
            {k}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="capitalize">{kind} CSV</CardTitle>
          <CardDescription>{t.note}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">{t.header.join(", ")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download template
            </Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" />
              Choose CSV file
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
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

          <Button disabled={!rows || rows.length === 0} loading={busy} onClick={runImport}>
            Import {rows ? rows.length : ""} {kind}
          </Button>
        </CardContent>
      </Card>

      {credentials.length > 0 && (
        <Card className="mt-6 border-warning">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" aria-hidden /> One-time passwords for {credentials.length} new account(s)
            </CardTitle>
            <CardDescription>
              These passwords are shown only once and are not stored anywhere. Download the sheet now and hand each person their own
              login privately. Everyone must set a new password at first sign-in. If a sheet is lost, use Reset password in the admin
              portal to issue a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={downloadCredentials}>
              <Download className="h-4 w-4" /> Download credentials (CSV)
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Import result
            </CardTitle>
            <CardDescription>
              {result.created} created · {result.updated} updated · {result.errors.length} error(s)
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
