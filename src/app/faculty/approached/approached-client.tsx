"use client";

import * as React from "react";
import { Check, Download, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusBadge } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PagedTable } from "@/components/paged-table";
import { APPROACHED_HEADERS as H, MSG, PAGE_SIZE } from "@/lib/config";
import { exportTable, safeFilePart } from "@/lib/excel";
import { cleanSearch } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { RequestDetail } from "@/lib/types";
import { useFaculty } from "../faculty-context";

export function ApproachedClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const { faculty, tick, bump, frozen } = useFaculty();
  const [action, setAction] = React.useState<{ row: RequestDetail; status: "accepted" | "declined" } | null>(null);
  const full = faculty.available_seats <= 0;
  const locked = (r: RequestDetail) => (frozen ? MSG.FROZEN_TIP : r.status === "pending" && full ? "No seats available" : undefined);

  async function respond() {
    if (!action) return;
    const { error } = await supabase.rpc("respond_request", { p_request_id: action.row.id, p_status: action.status });
    if (error) toast.error(error.message);
    else toast.success(action.status === "accepted" ? `Accepted ${action.row.student_name}` : `Declined ${action.row.student_name}`);
    bump();
  }

  async function download() {
    const { data, error } = await supabase
      .from("request_details_v")
      .select("*")
      .eq("faculty_id", faculty.id)
      .eq("status", "accepted")
      .order("reg_no")
      .limit(1000);
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) {
      toast.info("No accepted students to download yet.");
      return;
    }
    const rows = (data as RequestDetail[]).map((r) => ({
      reg_no: r.reg_no,
      name: r.student_name,
      dept: r.dept,
      section: r.student_section ?? "",
      email: r.student_email ?? "",
      batch: r.batch_no ? `B${r.batch_no}` : "Unassigned",
      accepted: r.responded_at ? new Date(r.responded_at).toLocaleDateString("en-GB") : "",
    }));
    await exportTable(`MAPP_${safeFilePart(faculty.name)}_Students.xlsx`, "Accepted students", [
      { header: "Registration Number", key: "reg_no", width: 22 },
      { header: "Student Name", key: "name", width: 30 },
      { header: "Dept", key: "dept", width: 14 },
      { header: "Section", key: "section", width: 10 },
      { header: "Email", key: "email", width: 32 },
      { header: "Batch", key: "batch", width: 12 },
      { header: "Accepted On", key: "accepted", width: 14 },
    ], rows);
    toast.success("Excel downloaded");
  }

  return (
    <>
      <PageHeader
        title="Students Approached"
        description={full ? "All seats are filled. Remaining pending requests can only be declined." : "Students who have requested you. Accept to take a seat."}
        actions={
          <Button variant="outline" onClick={download}>
            <Download className="h-4 w-4" />
            Download accepted (Excel)
          </Button>
        }
      />
      <PagedTable<RequestDetail>
        rowKey={(r) => r.id}
        searchPlaceholder="Search by registration number or name"
        refreshKey={tick}
        emptyTitle="No requests yet"
        emptyHint="Students who request you will appear here."
        onError={(m) => toast.error(m)}
        fetchPage={async (page, search, signal) => {
          let q = supabase
            .from("request_details_v")
            .select("*", { count: "exact" })
            .eq("faculty_id", faculty.id)
            .order("status_rank")
            .order("created_at")
            .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
          const term = cleanSearch(search);
          if (term) q = q.or(`reg_no.ilike.%${term}%,student_name.ilike.%${term}%`);
          const { data, count, error } = await q.abortSignal(signal);
          if (error) throw new Error(error.message);
          return { rows: (data ?? []) as RequestDetail[], total: count ?? 0 };
        }}
        columns={[
          { header: H[0], cell: (r) => <span className="font-mono text-xs">{r.reg_no}</span> },
          { header: H[1], cell: (r) => <span className="font-medium">{r.student_name}</span> },
          { header: H[2], cell: (r) => r.student_section ?? "—" },
          { header: H[3], cell: (r) => <StatusBadge status={r.status} /> },
          {
            header: H[4],
            cell: (r) =>
              r.status === "pending" ? (
                <Button size="sm" variant="success" disabled={full || frozen} title={locked(r)} onClick={() => setAction({ row: r, status: "accepted" })}>
                  <Check className="h-3.5 w-3.5" />
                  Accept
                </Button>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            header: H[5],
            cell: (r) =>
              r.status === "pending" ? (
                <Button size="sm" variant="destructive" disabled={frozen} title={frozen ? MSG.FROZEN_TIP : undefined} onClick={() => setAction({ row: r, status: "declined" })}>
                  <X className="h-3.5 w-3.5" />
                  Decline
                </Button>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]}
      />
      <ConfirmDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.status === "accepted" ? `Accept ${action.row.student_name}?` : `Decline ${action?.row.student_name}?`}
        description={
          action?.status === "accepted"
            ? "This uses one of your seats."
            : "The student's Minor portal will unlock so they can approach another faculty."
        }
        confirmLabel={action?.status === "accepted" ? "Accept" : "Decline"}
        destructive={action?.status === "declined"}
        onConfirm={respond}
      />
    </>
  );
}
