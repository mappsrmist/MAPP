"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Badge, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PagedTable } from "@/components/paged-table";
import { PAGE_SIZE } from "@/lib/config";
import { buildApplicationRows, type ApplicationRecord, type TeamApplicationRow } from "@/lib/application-rows";
import { exportTable, safeFilePart } from "@/lib/excel";
import { createClient } from "@/lib/supabase/client";
import type { BatchRow, RequestDetail } from "@/lib/types";
import { useFaculty } from "../faculty-context";

const TONE = { Submitted: "success", Draft: "warning", "Not started": "neutral" } as const;

/** Read-only view of the Application Form data of this guide's teams. */
export function ApplicationsClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const { faculty, tick } = useFaculty();
  const [rows, setRows] = React.useState<TeamApplicationRow[]>([]);
  const [version, setVersion] = React.useState(0);

  const load = React.useCallback(async () => {
    const [s, b, a] = await Promise.all([
      supabase.from("request_details_v").select("student_id, reg_no, student_name").eq("faculty_id", faculty.id).eq("status", "accepted").limit(1000),
      supabase.from("batches").select("id, batch_no, batch_members(slot, student_id, section, advisor_name, contact_number, srm_mail)").eq("faculty_id", faculty.id).order("batch_no"),
      supabase.from("applications").select("student1_id, student2_id, project_title, sdg_goal, problem_by_guide, student1_mobile, student2_mobile, status").eq("faculty_id", faculty.id),
    ]);
    const err = s.error ?? b.error ?? a.error;
    if (err) return void toast.error(err.message);
    const students = Object.fromEntries((s.data as Pick<RequestDetail, "student_id" | "reg_no" | "student_name">[]).map((x) => [x.student_id, { name: x.student_name, reg_no: x.reg_no }]));
    setRows(buildApplicationRows(b.data as unknown as BatchRow[], students, a.data as ApplicationRecord[]));
    setVersion((v) => v + 1);
  }, [supabase, faculty.id]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, tick]);

  async function download() {
    await exportTable(
      `MAPP_${safeFilePart(faculty.name)}_Applications.xlsx`,
      "Applications",
      [
        { header: "Batch", key: "batch", width: 8 },
        { header: "Team", key: "team", width: 40 },
        { header: "Project Title", key: "title", width: 36 },
        { header: "SDG Goal", key: "sdg", width: 30 },
        { header: "Problem by Guide", key: "problem", width: 16 },
        { header: "Student Mobile No(s)", key: "mobiles", width: 30 },
        { header: "Status", key: "status", width: 14 },
      ],
      rows.map((r) => ({
        batch: `B${r.batchNo}`,
        team: r.members.map((m) => `${m.name} (${m.regNo})`).join(" / "),
        title: r.title,
        sdg: r.sdg,
        problem: r.problem,
        mobiles: r.members.map((m) => m.mobile).filter(Boolean).join(" / "),
        status: r.status,
      })),
    );
    toast.success("Excel downloaded");
  }

  return (
    <>
      <PageHeader
        title="Applications"
        description="The Application Form details your teams have filled in. Read-only; teams that have not started show blank cells."
        actions={
          <Button variant="outline" disabled={rows.length === 0} onClick={() => void download()}>
            <Download className="h-4 w-4" /> Download (Excel)
          </Button>
        }
      />
      <PagedTable<TeamApplicationRow>
        rowKey={(r) => String(r.batchNo)}
        refreshKey={version}
        searchPlaceholder="Search by student, registration number or title"
        emptyTitle="No teams yet"
        emptyHint="Teams appear here once you group students under Batch Grouping."
        fetchPage={async (page, search) => {
          const q = search.trim().toLowerCase();
          const hit = rows.filter(
            (r) =>
              !q ||
              r.title.toLowerCase().includes(q) ||
              r.members.some((m) => m.name.toLowerCase().includes(q) || m.regNo.toLowerCase().includes(q)),
          );
          return { rows: hit.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: hit.length };
        }}
        columns={[
          { header: "Batch", cell: (r) => <Badge tone="info">B{r.batchNo}</Badge> },
          {
            header: "Team (Student 1 / Student 2)",
            cell: (r) => (
              <div className="space-y-0.5">
                {r.members.map((m) => (
                  <p key={m.regNo}>
                    <span className="font-medium">{m.name}</span> <span className="font-mono text-xs text-muted-foreground">{m.regNo}</span>
                  </p>
                ))}
              </div>
            ),
          },
          { header: "Project Title", cell: (r) => r.title || "—" },
          { header: "SDG Goal", cell: (r) => r.sdg || "—" },
          { header: "Problem by Guide", cell: (r) => r.problem || "—" },
          {
            header: "Student Mobile No(s)",
            cell: (r) => (
              <div className="space-y-0.5 font-mono text-xs">
                {r.members.map((m) => (
                  <p key={m.regNo}>{m.mobile || "—"}</p>
                ))}
              </div>
            ),
          },
          { header: "Status", cell: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
        ]}
      />
    </>
  );
}
