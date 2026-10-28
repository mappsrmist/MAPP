"use client";

import * as React from "react";
import { CheckCircle2, Clock, MapPin, Phone, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton, StatusBadge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/form";
import { PagedTable } from "@/components/paged-table";
import { MSG } from "@/lib/config";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { FacultyDetail, FacultyListRow, MinorStatus } from "@/lib/types";

export function MinorClient({ userId }: { userId: string }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [status, setStatus] = React.useState<MinorStatus | null | undefined>(undefined); // undefined = loading
  const [domains, setDomains] = React.useState<string[]>([]);
  const [domain, setDomain] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);

  const loadStatus = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("my_minor_status");
    if (error) {
      toast.error(error.message);
      setStatus((s) => s ?? null); // fall back to the list view instead of an endless skeleton
      return;
    }
    setStatus((data as MinorStatus[] | null)?.[0] ?? null);
  }, [supabase]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
  }, [loadStatus]);

  // The student's own request changes (accepted / declined) arrive live; faculty seat changes are
  // picked up by the list's polling + focus refetch because students cannot read `faculty` directly.
  useRealtime([{ table: "requests", filter: `student_id=eq.${userId}` }], () => {
    void loadStatus();
    setRefresh((n) => n + 1);
  });

  const active = status && (status.status === "pending" || status.status === "accepted");
  const declined = status?.status === "declined" ? status : null;

  React.useEffect(() => {
    if (status === undefined || active) return;
    void supabase.rpc("list_domains").then(({ data }) => setDomains((data as string[] | null) ?? []));
  }, [supabase, status, active, refresh]);

  if (status === undefined) {
    return (
      <>
        <PageHeader title="Minor Project" />
        <Skeleton className="h-48 w-full" />
      </>
    );
  }

  if (active) return <StatusCard status={status} />;

  return (
    <>
      <PageHeader title="Minor Project" description="Pick a faculty with available seats and send a request." />
      {declined && (
        <div role="status" className="mb-4 flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <p>
            Your previous request to <strong>{declined.faculty_name}</strong> was declined. You can now approach another faculty.
          </p>
        </div>
      )}
      <FacultyList domains={domains} domain={domain} setDomain={setDomain} refreshKey={refresh} onRequested={() => void loadStatus()} />
    </>
  );
}

function FacultyList({
  domains,
  domain,
  setDomain,
  refreshKey,
  onRequested,
}: {
  domains: string[];
  domain: string;
  setDomain: (d: string) => void;
  refreshKey: number;
  onRequested: () => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <>
      <PagedTable<FacultyListRow>
        rowKey={(r) => r.id}
        searchPlaceholder="Search by name or employee ID"
        deps={[domain]}
        refreshKey={refreshKey}
        pollMs={20000}
        emptyTitle="No faculty available"
        emptyHint="Faculty with no remaining seats are hidden. Try changing the search or domain filter."
        onError={(m) => toast.error(m)}
        toolbar={
          <Select aria-label="Filter by domain" value={domain} onChange={(e) => setDomain(e.target.value)} className="sm:w-64">
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        }
        fetchPage={async (page, search) => {
          const { data, error } = await supabase.rpc("list_faculty", { p_search: search || null, p_domain: domain || null, p_page: page });
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as FacultyListRow[];
          return { rows, total: Number(rows[0]?.total_count ?? 0) };
        }}
        columns={[
          { header: "Employee ID", cell: (r) => <span className="font-mono text-xs">{r.emp_id}</span> },
          {
            header: "Name",
            cell: (r) => (
              <button type="button" onClick={() => setSelected(r.id)} className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
                {r.name}
              </button>
            ),
          },
          { header: "Designation", cell: (r) => r.designation },
        ]}
      />
      <FacultyDialog facultyId={selected} onClose={() => setSelected(null)} onRequested={onRequested} />
    </>
  );
}

function FacultyDialog({ facultyId, onClose, onRequested }: { facultyId: string | null; onClose: () => void; onRequested: () => void }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [detail, setDetail] = React.useState<FacultyDetail | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const closeRef = React.useRef(onClose);
  React.useEffect(() => {
    closeRef.current = onClose;
  });

  React.useEffect(() => {
    if (!facultyId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    void supabase.rpc("get_faculty", { p_id: facultyId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        closeRef.current();
        return;
      }
      setDetail((data as FacultyDetail[])[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, facultyId]);

  async function request() {
    const { error } = await supabase.rpc("submit_request", { p_faculty_id: facultyId });
    if (error) {
      toast.error(error.message);
      onRequested(); // state may have changed under us (seat taken, already requested)
      onClose();
      return;
    }
    toast.success("Request sent");
    onRequested();
    onClose();
  }

  return (
    <>
      <Dialog open={!!facultyId && !confirm} onOpenChange={(o) => !o && onClose()}>
        <DialogContent title={detail?.name ?? "Faculty details"} description={detail?.designation}>
          {!detail ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Employee ID</dt>
                <dd className="font-mono">{detail.emp_id}</dd>
                <dt className="text-muted-foreground">Name</dt>
                <dd>{detail.name}</dd>
                <dt className="text-muted-foreground">Phone number</dt>
                <dd>{detail.phone ?? "—"}</dd>
                <dt className="text-muted-foreground">Venue</dt>
                <dd>{detail.venue ?? "—"}</dd>
                <dt className="text-muted-foreground">Domain(s)</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {detail.domains.length ? detail.domains.map((d) => <Badge key={d} tone="info">{d}</Badge>) : "—"}
                </dd>
                <dt className="text-muted-foreground">Available seats</dt>
                <dd>
                  <Badge tone="success">
                    {detail.available_seats} of {detail.total_seats}
                  </Badge>
                </dd>
              </dl>
              <DialogFooter>
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                <Button onClick={() => setConfirm(true)}>Request</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Request ${detail?.name ?? "this faculty"}?`}
        description="You can only have one request at a time. You can approach another faculty only if this one declines."
        confirmLabel="Send request"
        onConfirm={request}
      />
    </>
  );
}

function StatusCard({ status }: { status: MinorStatus }) {
  const accepted = status.status === "accepted";
  return (
    <>
      <PageHeader title="Minor Project" description="Your request status" />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            {accepted ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : <Clock className="h-5 w-5 text-warning" aria-hidden />}
            {status.faculty_name}
          </CardTitle>
          <StatusBadge status={status.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Employee ID</dt>
            <dd className="font-mono">{status.faculty_emp_id}</dd>
            <dt className="text-muted-foreground">Designation</dt>
            <dd>{status.designation}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{status.status}</dd>
          </dl>
          <div className="rounded-lg border bg-accent/50 p-4 text-sm">
            <p className="font-medium">{accepted ? "Your request has been accepted. Contact your faculty for the next steps." : MSG.MEET_FACULTY}</p>
            <p className="mt-3 flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span>{status.phone ?? "—"}</span>
            </p>
            <p className="mt-1 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span>{status.venue ?? "—"}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
