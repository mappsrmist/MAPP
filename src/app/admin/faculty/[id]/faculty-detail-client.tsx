"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Badge, PageHeader, Skeleton, StatusBadge } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Facts, fmtDate, PROJECT_TYPE_LABEL, Section } from "@/components/detail-parts";
import { CLASS_STATUS_LABEL } from "@/components/class-overview";
import { CADRE_LABEL, type Cadre } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import type { ClassStatus } from "@/lib/types";

interface Member {
  slot: number;
  student_id: string;
  reg_no: string;
  name: string;
  section: string;
  advisor_name: string;
  contact_number: string;
  srm_mail: string;
}
interface Detail {
  faculty: {
    id: string;
    emp_id: string;
    name: string;
    srm_email: string;
    phone: string | null;
    venue: string | null;
    department: string | null;
    designation: string | null;
    cadre: Cadre;
    domains: string[];
    total_seats: number;
    accepted_count: number;
    available_seats: number;
    frozen: boolean;
    username: string | null;
  };
  batches: {
    id: string;
    batch_no: number;
    members: Member[];
    application: {
      status: "draft" | "submitted";
      project_title: string | null;
      project_type: string | null;
      sdg_goal: string | null;
      problem_by_guide: boolean | null;
      s1_mobile: string | null;
      s2_mobile: string | null;
    } | null;
  }[];
  requests: {
    id: string;
    status: string;
    created_at: string;
    responded_at: string | null;
    student_id: string;
    reg_no: string;
    name: string;
    section: string | null;
    email: string | null;
    grouped: boolean;
    project_title: string | null;
  }[];
  advisees: { student_id: string; reg_no: string; name: string; section: string | null; email: string | null; status: ClassStatus }[];
}

const STATUS_TONE = { minor: "info", mooc: "success", mooc_pending: "warning", not_opted: "warning", exempt: "neutral" } as const;
const linkCls = "font-medium text-primary underline-offset-2 hover:underline";

export function FacultyDetailClient({ id }: { id: string }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [data, setData] = React.useState<Detail | null>(null);
  const [missing, setMissing] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void supabase.rpc("admin_faculty_detail", { p_faculty: id }).then(({ data: d, error }) => {
      if (!live) return;
      if (error) {
        toast.error(error.message);
        setMissing(true);
      } else setData(d as Detail);
    });
    return () => {
      live = false;
    };
  }, [supabase, id]);

  const back = (
    <Link href="/admin/faculty" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ArrowLeft className="h-4 w-4" /> Faculty
    </Link>
  );

  if (missing) return <PageHeader title="Faculty not found" description="This faculty member could not be loaded." actions={back} />;
  if (!data)
    return (
      <>
        <PageHeader title="Faculty" actions={back} />
        <Skeleton className="mb-5 h-40" />
        <Skeleton className="mb-5 h-40" />
        <Skeleton className="h-40" />
      </>
    );

  const { faculty: f, batches, requests, advisees } = data;
  const groupedIds = new Set(batches.flatMap((b) => b.members.map((m) => m.student_id)));
  const accepted = requests.filter((r) => r.status === "accepted");
  const ungrouped = accepted.filter((r) => !groupedIds.has(r.student_id));
  const pending = requests.filter((r) => r.status === "pending");
  const declined = requests.filter((r) => r.status === "declined");

  return (
    <>
      <PageHeader
        title={f.name}
        description={`${f.emp_id} · ${CADRE_LABEL[f.cadre]}`}
        actions={
          <div className="flex items-center gap-2">
            {f.frozen && <Badge tone="info">Frozen</Badge>}
            <Badge tone={f.available_seats > 0 ? "success" : "danger"}>
              {f.available_seats} / {f.total_seats} seats free
            </Badge>
            {back}
          </div>
        }
      />

      <Section title="Faculty">
        <Facts
          items={[
            ["Employee ID", <span key="e" className="font-mono">{f.emp_id}</span>],
            ["Name", f.name],
            ["SRM Email", f.srm_email],
            ["Phone", f.phone],
            ["Venue", f.venue],
            ["Department", f.department],
            ["Designation", f.designation],
            ["Cadre", CADRE_LABEL[f.cadre]],
            ["Domains", f.domains.length ? f.domains.join(", ") : null],
            ["Seats", `${f.accepted_count} filled of ${f.total_seats} (${f.available_seats} available)`],
            ["Allocations", f.frozen ? "Frozen by admin" : "Open"],
            ["Login username", f.username],
          ]}
        />
      </Section>

      <Section title={`Teams (${batches.length})`}>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teams have been formed yet.</p>
        ) : (
          <div className="space-y-4">
            {batches.map((b) => (
              <div key={b.id} className="rounded-xl border p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="info">Batch B{b.batch_no}</Badge>
                  {b.application ? (
                    <Badge tone={b.application.status === "submitted" ? "success" : "warning"} className="capitalize">
                      Application {b.application.status}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">No application yet</Badge>
                  )}
                </div>
                {b.application && (
                  <div className="mb-4">
                    <Facts
                      items={[
                        ["Project title", <span key="t" className="font-medium">{b.application.project_title}</span>],
                        ["Project type", b.application.project_type ? PROJECT_TYPE_LABEL[b.application.project_type] ?? b.application.project_type : null],
                        ["SDG goal", b.application.sdg_goal],
                        ["Problem given by guide", b.application.problem_by_guide == null ? null : b.application.problem_by_guide ? "Yes" : "No"],
                      ]}
                    />
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {b.members.map((m) => (
                    <div key={m.student_id} className="rounded-lg bg-muted/50 p-3">
                      <Link href={`/admin/students/${m.student_id}`} className={linkCls}>
                        {m.name}
                      </Link>
                      <div className="mt-2">
                        <Facts
                          items={[
                            ["Reg No.", <span key="r" className="font-mono">{m.reg_no}</span>],
                            ["Section", m.section],
                            ["Faculty Advisor", m.advisor_name],
                            ["Contact", m.contact_number],
                            ["SRM Mail", m.srm_mail],
                          ]}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <RequestList title="Accepted, not yet grouped" rows={ungrouped} empty="Every accepted student is placed in a batch." />
      <RequestList title="Pending requests" rows={pending} empty="No pending requests." />
      <RequestList title="Declined requests" rows={declined} empty="No declined requests." />

      <Section title={`Faculty Advisor for (${advisees.length} students)`}>
        {advisees.length === 0 ? (
          <p className="text-sm text-muted-foreground">This faculty member is not the Faculty Advisor of any student.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Reg No</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Section</th>
                  <th className="py-2 pr-4 font-medium">SRM Mail</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {advisees.map((a) => (
                  <tr key={a.student_id} className="border-t">
                    <td className="py-2 pr-4 font-mono text-xs">{a.reg_no}</td>
                    <td className="py-2 pr-4">
                      <Link href={`/admin/students/${a.student_id}`} className={linkCls}>
                        {a.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{a.section ?? "—"}</td>
                    <td className="py-2 pr-4">{a.email ?? "—"}</td>
                    <td className="py-2">
                      <Badge tone={STATUS_TONE[a.status]}>{CLASS_STATUS_LABEL[a.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function RequestList({ title, rows, empty }: { title: string; rows: Detail["requests"]; empty: string }) {
  return (
    <Section title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">Reg No</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Section</th>
                <th className="py-2 pr-4 font-medium">SRM Mail</th>
                <th className="py-2 pr-4 font-medium">Project title</th>
                <th className="py-2 pr-4 font-medium">Requested</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">{r.reg_no}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/admin/students/${r.student_id}`} className={linkCls}>
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{r.section ?? "—"}</td>
                  <td className="py-2 pr-4">{r.email ?? "—"}</td>
                  <td className="py-2 pr-4">{r.project_title ?? "—"}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
