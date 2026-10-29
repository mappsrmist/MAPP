"use client";

import * as React from "react";
import { toast } from "sonner";
import { PagedTable } from "@/components/paged-table";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useFaculty } from "../faculty-context";
import type { AdvisorMoocRequest } from "@/lib/types";

export function MoocReviews({ section, refreshKey, onChanged }: { section: string; refreshKey: number; onChanged: () => void }) {
  const supabase = React.useMemo(() => createClient(), []);
  const { frozen } = useFaculty();
  const [decision, setDecision] = React.useState<{ row: AdvisorMoocRequest; value: "approved" | "declined" } | null>(null);
  return (
    <section aria-labelledby="mooc-reviews-heading" className="mb-8">
      <h2 id="mooc-reviews-heading" className="mb-1 text-lg font-semibold">MOOC approval requests</h2>
      <p className="mb-4 text-sm text-muted-foreground">Check the student’s details and CGPA before deciding. A CGPA of 9.00 is eligible. Approval grants MOOC access; declining lets the student choose again.</p>
      <PagedTable<AdvisorMoocRequest>
        rowKey={(r) => r.request_id}
        deps={[section]}
        refreshKey={refreshKey}
        pollMs={20000}
        emptyTitle="No MOOC requests for this section"
        searchPlaceholder="Search student name or registration number"
        onError={(message) => toast.error(message)}
        fetchPage={async (page, search) => {
          const { data, error } = await supabase.rpc("fa_mooc_requests", { p_section: section, p_search: search || null, p_page: page });
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as AdvisorMoocRequest[];
          return { rows, total: Number(rows[0]?.total_count ?? 0) };
        }}
        columns={[
          { header: "Reg No", cell: (r) => <span className="font-mono text-xs">{r.reg_no}</span> },
          { header: "Name", cell: (r) => r.name },
          { header: "Section", cell: (r) => r.section },
          { header: "Student SRM Mail", cell: (r) => r.email ?? "—" },
          { header: "CGPA", cell: (r) => <span className="font-semibold tabular-nums">{r.cgpa == null ? "Not provided" : Number(r.cgpa).toFixed(2)}</span> },
          { header: "Requested", cell: (r) => new Date(r.requested_at).toLocaleDateString("en-IN") },
          { header: "Status", cell: (r) => <Badge tone={r.status === "approved" ? "success" : r.status === "pending" ? "warning" : "neutral"}>{r.status === "pending" ? "Pending review" : r.status === "approved" ? "Approved" : r.status === "cancelled" ? "Cancelled" : "Declined"}</Badge> },
          { header: "Decision", cell: (r) => r.status === "pending" ? <div className="flex gap-2"><Button size="sm" disabled={frozen || r.cgpa == null} onClick={() => setDecision({ row: r, value: "approved" })}>Approve</Button><Button size="sm" variant="outline" disabled={frozen} onClick={() => setDecision({ row: r, value: "declined" })}>Decline</Button></div> : "—" },
        ]}
      />
      <ConfirmDialog open={decision !== null} onOpenChange={(open) => { if (!open) setDecision(null); }} title={decision?.value === "approved" ? "Approve MOOC request?" : "Decline MOOC request?"}
        description={decision ? decision.row.name + " (" + decision.row.reg_no + ") — CGPA: " + (decision.row.cgpa == null ? "Not provided" : Number(decision.row.cgpa).toFixed(2)) + (decision.value === "approved" ? ". Approval grants MOOC access." : ". The student can reapply or choose Minor.") : ""}
        confirmLabel={decision?.value === "approved" ? "Approve" : "Decline"} confirmDisabled={frozen}
        onConfirm={async () => {
          if (!decision || frozen) return;
          const { error } = await supabase.rpc("respond_mooc_request", { p_request: decision.row.request_id, p_decision: decision.value });
          if (error) { toast.error(error.message); return; }
          toast.success(decision.value === "approved" ? "MOOC request approved" : "MOOC request declined");
          onChanged();
        }} />
    </section>
  );
}
