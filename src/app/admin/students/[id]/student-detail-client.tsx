"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Badge, PageHeader, Skeleton, StatusBadge } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Facts, fmtDate, PROJECT_TYPE_LABEL, Section } from "@/components/detail-parts";
import { CLASS_STATUS_LABEL } from "@/components/class-overview";
import { createClient } from "@/lib/supabase/client";
import type { ClassStatus } from "@/lib/types";

interface FacultyBrief {
  id: string;
  emp_id: string;
  name: string;
  srm_email: string;
  phone: string | null;
  venue: string | null;
}
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
  student: {
    id: string;
    reg_no: string;
    name: string;
    dept: string;
    section: string | null;
    email: string | null;
    choice: string | null;
    choice_at: string | null;
    mooc_cgpa: number | null;
    is_active: boolean;
    exempt_reason: string | null;
    created_at: string;
    username: string | null;
  };
  advisor: FacultyBrief | null;
  mooc_requests: { status: string; cgpa: number | null; requested_at: string; reviewed_at: string | null }[];
  requests: (Omit<FacultyBrief, "id" | "srm_email" | "phone" | "venue"> & {
    id: string;
    status: string;
    created_at: string;
    responded_at: string | null;
    faculty_id: string;
    faculty_emp_id: string;
    faculty_name: string;
    faculty_email: string;
    faculty_phone: string | null;
    faculty_venue: string | null;
    faculty_domains: string[];
  })[];
  batch: { id: string; batch_no: number; faculty_emp_id: string; faculty_name: string; members: Member[] } | null;
  application: {
    id: string;
    status: "draft" | "submitted";
    project_title: string | null;
    project_type: string | null;
    sdg_goal: string | null;
    problem_by_guide: boolean | null;
    updated_at: string;
    guide_emp_id: string;
    guide_name: string;
    s1_id: string;
    s1_name: string;
    s1_reg: string;
    s1_section: string | null;
    s1_mail: string | null;
    s1_mobile: string | null;
    s2_id: string | null;
    s2_name: string | null;
    s2_reg: string | null;
    s2_section: string | null;
    s2_mail: string | null;
    s2_mobile: string | null;
  } | null;
}

const STATUS_TONE = { minor: "info", mooc: "success", mooc_pending: "warning", not_opted: "warning", exempt: "neutral" } as const;

function studentStatus(choice: string | null): ClassStatus {
  return choice === "minor" ? "minor" : choice === "mooc" ? "mooc" : choice === "mooc_pending" ? "mooc_pending" : choice === "exempt" ? "exempt" : "not_opted";
}

export function StudentDetailClient({ id }: { id: string }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [data, setData] = React.useState<Detail | null>(null);
  const [missing, setMissing] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void supabase.rpc("admin_student_detail", { p_student: id }).then(({ data: d, error }) => {
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
    <Link href="/admin/students" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ArrowLeft className="h-4 w-4" /> Students
    </Link>
  );

  if (missing) return <PageHeader title="Student not found" description="This student could not be loaded." actions={back} />;
  if (!data)
    return (
      <>
        <PageHeader title="Student" actions={back} />
        <Skeleton className="mb-5 h-40" />
        <Skeleton className="mb-5 h-40" />
        <Skeleton className="h-40" />
      </>
    );

  const { student: s, advisor, mooc_requests, requests, batch, application: app } = data;
  const status = studentStatus(s.choice);
  const minorRequest = requests.find((r) => r.status === "accepted") ?? requests.find((r) => r.status === "pending") ?? requests[0] ?? null;
  const partner = batch?.members.find((m) => m.student_id !== s.id) ?? null;

  return (
    <>
      <PageHeader
        title={s.name}
        description={`${s.reg_no} · Section ${s.section ?? "—"} · ${s.dept}`}
        actions={
          <div className="flex items-center gap-2">
            {!s.is_active && <Badge tone="danger">Removed</Badge>}
            <Badge tone={STATUS_TONE[status]}>{CLASS_STATUS_LABEL[status]}</Badge>
            {back}
          </div>
        }
      />

      <Section title="Student">
        <Facts
          items={[
            ["Registration No.", <span key="r" className="font-mono">{s.reg_no}</span>],
            ["Name", s.name],
            ["Department", s.dept],
            ["Section", s.section],
            ["Student SRM Mail", s.email],
            ["Login username", s.username],
            ["Choice", CLASS_STATUS_LABEL[status]],
            ["Choice made on", fmtDate(s.choice_at)],
            ["MOOC CGPA", s.mooc_cgpa != null ? Number(s.mooc_cgpa).toFixed(2) : null],
            ["Exempt reason", s.exempt_reason],
            ["Account", s.is_active ? "Active" : "Removed (login disabled)"],
            ["Imported on", fmtDate(s.created_at)],
          ]}
        />
      </Section>

      <Section title="Faculty Advisor">
        {advisor ? (
          <Facts
            items={[
              ["Name", <Link key="n" href={`/admin/faculty/${advisor.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{advisor.name}</Link>],
              ["Employee ID", <span key="e" className="font-mono">{advisor.emp_id}</span>],
              ["SRM Email", advisor.srm_email],
              ["Phone", advisor.phone],
              ["Venue", advisor.venue],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No Faculty Advisor is assigned to this student.</p>
        )}
      </Section>

      {mooc_requests.length > 0 && (
        <Section title="MOOC requests">
          <div className="space-y-2">
            {mooc_requests.map((m, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border p-3 text-sm">
                <Badge tone={m.status === "approved" ? "success" : m.status === "pending" ? "warning" : m.status === "declined" ? "danger" : "neutral"} className="capitalize">
                  {m.status}
                </Badge>
                <span>CGPA {m.cgpa != null ? Number(m.cgpa).toFixed(2) : "—"}</span>
                <span className="text-muted-foreground">Requested {fmtDate(m.requested_at)}</span>
                {m.reviewed_at && <span className="text-muted-foreground">Reviewed {fmtDate(m.reviewed_at)}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Minor project guide" aside={minorRequest && <StatusBadge status={batch && minorRequest.status === "accepted" ? "grouped" : minorRequest.status} />}>
        {minorRequest ? (
          <>
            <Facts
              items={[
                ["Guide", <Link key="g" href={`/admin/faculty/${minorRequest.faculty_id}`} className="font-medium text-primary underline-offset-2 hover:underline">{minorRequest.faculty_name}</Link>],
                ["Guide Employee ID", <span key="e" className="font-mono">{minorRequest.faculty_emp_id}</span>],
                ["Guide SRM Email", minorRequest.faculty_email],
                ["Guide phone", minorRequest.faculty_phone],
                ["Guide venue", minorRequest.faculty_venue],
                ["Guide domains", minorRequest.faculty_domains.join(", ")],
                ["Requested on", fmtDate(minorRequest.created_at)],
                ["Responded on", fmtDate(minorRequest.responded_at)],
              ]}
            />
            {requests.length > 1 && (
              <div className="mt-4 border-t pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Request history</p>
                <ul className="space-y-1 text-sm">
                  {requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={r.status} />
                      <span>{r.faculty_name}</span>
                      <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This student has not sent a Minor project request.</p>
        )}
      </Section>

      <Section title="Team (batch)" aside={batch && <Badge tone="info">Batch B{batch.batch_no}</Badge>}>
        {batch ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Guide: <span className="font-medium text-foreground">{batch.faculty_name}</span> <span className="font-mono text-xs">({batch.faculty_emp_id})</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {batch.members.map((m) => (
                <div key={m.student_id} className="rounded-xl border p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Link href={`/admin/students/${m.student_id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {m.name}
                    </Link>
                    {m.student_id === s.id ? <Badge tone="info">This student</Badge> : <Badge>Team mate</Badge>}
                  </div>
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
              ))}
            </div>
            {!partner && <p className="mt-3 text-sm text-muted-foreground">No team mate in this batch.</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {minorRequest?.status === "accepted" ? "Accepted by the guide but not placed in a batch yet." : "Not in a batch."}
          </p>
        )}
      </Section>

      <Section title="Project application" aside={app && <Badge tone={app.status === "submitted" ? "success" : "warning"} className="capitalize">{app.status}</Badge>}>
        {app ? (
          <>
            <Facts
              items={[
                ["Project title", <span key="t" className="font-medium">{app.project_title}</span>],
                ["Project type", app.project_type ? PROJECT_TYPE_LABEL[app.project_type] ?? app.project_type : null],
                ["SDG goal", app.sdg_goal],
                ["Problem given by guide", app.problem_by_guide == null ? null : app.problem_by_guide ? "Yes" : "No"],
                ["Guide", `${app.guide_name} (${app.guide_emp_id})`],
                ["Last updated", fmtDate(app.updated_at)],
              ]}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <p className="mb-2 text-sm font-medium">Student 1</p>
                <Facts items={[["Name", app.s1_name], ["Reg No.", app.s1_reg], ["Section", app.s1_section], ["SRM Mail", app.s1_mail], ["Mobile", app.s1_mobile]]} />
              </div>
              <div className="rounded-xl border p-4">
                <p className="mb-2 text-sm font-medium">Student 2</p>
                <Facts items={[["Name", app.s2_name], ["Reg No.", app.s2_reg], ["Section", app.s2_section], ["SRM Mail", app.s2_mail], ["Mobile", app.s2_mobile]]} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No application form has been started by this student's team.</p>
        )}
      </Section>
    </>
  );
}
