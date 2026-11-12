"use client";

import * as React from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Badge, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

export interface PersonRef {
  kind: "student" | "faculty";
  id: string;
}

type Row = Record<string, unknown>;

const show = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("en-GB");
  return String(v);
};

/**
 * Admin-only view of one student or faculty member with every stored detail, plus a password reset.
 * Reads go through the admin's own session (RLS); the reset uses the existing admin-only route.
 */
export function PersonDetailsDialog({ person, onClose }: { person: PersonRef | null; onClose: () => void }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [data, setData] = React.useState<Row | null>(null);
  const [extra, setExtra] = React.useState<[string, string][]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const id = person?.id;
  const kind = person?.kind;

  React.useEffect(() => {
    if (!id || !kind) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setExtra([]);
    setError(null);
    setArmed(false);
    void (async () => {
      const table = kind === "student" ? "students" : "faculty";
      const { data: row, error: err } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
      if (!live) return;
      if (err || !row) return setError(err?.message ?? "Details not found.");
      const lines: [string, string][] = [];
      const [{ data: profile }, advisor] = await Promise.all([
        supabase.from("profiles").select("username, must_change_password").eq("id", id).maybeSingle(),
        kind === "student" && row.fa_id
          ? supabase.from("faculty").select("name, emp_id, srm_email").eq("id", row.fa_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (profile) {
        lines.push(["Login username", String(profile.username)]);
        lines.push(["Password status", profile.must_change_password ? "Initial password (not changed yet)" : "Changed by the user"]);
      }
      if (advisor.data) lines.push(["Faculty Advisor", `${advisor.data.name} (${advisor.data.emp_id}) · ${advisor.data.srm_email}`]);
      if (kind === "student") {
        const { data: m } = await supabase.from("request_details_v").select("faculty_name, faculty_emp_id, status, batch_no, slot").eq("student_id", id);
        (m ?? []).forEach((r) =>
          lines.push([
            "Minor request",
            `${r.faculty_name} (${r.faculty_emp_id}) · ${r.status}${r.batch_no ? ` · Batch B${r.batch_no}, slot ${r.slot ?? "—"}` : ""}`,
          ]),
        );
      }
      if (!live) return;
      setData(row as Row);
      setExtra(lines);
    })();
    return () => {
      live = false;
    };
  }, [id, kind, supabase]);

  async function resetPassword() {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not reset password");
      toast.success(
        `Password reset. ${json.username} signs in with their ${kind === "student" ? "registration number" : "employee ID"} and must choose a new password.`,
      );
      setArmed(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  // every stored column, except internal ids and timestamps shown separately
  const HIDE = new Set(["id", "fa_id"]);
  const fields = data ? Object.entries(data).filter(([k]) => !HIDE.has(k)) : [];
  const title = data ? String(data.name ?? "Details") : "Details";

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={title}
        description={kind === "student" ? "Student details" : "Faculty details"}
        className="max-w-xl"
      >
        {error ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : !data ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
            {[...fields.map(([k, v]) => [k.replace(/_/g, " "), show(v)] as [string, string]), ...extra].map(([label, value], i) => (
              <React.Fragment key={`${label}-${i}`}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:pt-0.5">{label}</dt>
                <dd className="break-words font-medium">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        <DialogFooter>
          {data && !armed && (
            <Button variant="outline" onClick={() => setArmed(true)}>
              <KeyRound className="h-4 w-4" /> Reset password
            </Button>
          )}
          {data && armed && (
            <>
              <span className="self-center text-sm text-muted-foreground">
                Password goes back to the {kind === "student" ? "registration number" : "employee ID"}. <Badge tone="warning">Confirm</Badge>
              </span>
              <Button variant="outline" onClick={() => setArmed(false)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" loading={busy} onClick={() => void resetPassword()}>Yes, reset</Button>
            </>
          )}
          {!armed && <Button onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
