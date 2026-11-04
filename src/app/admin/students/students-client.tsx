"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { ClassOverview } from "@/components/class-overview";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";
import type { SectionRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AllocationsClient } from "../allocations/allocations-client";
import { StudentList, type StudentListKind } from "../student-list";

export type StudentsTab = "section" | "allocations" | StudentListKind;

const TABS: { key: StudentsTab; label: string; hint: string }[] = [
  { key: "section", label: "By section", hint: "Every student of a section with their status, guide and project title." },
  { key: "mooc_pending", label: "MOOC pending", hint: "Students who asked for MOOC and are waiting for their Faculty Advisor's approval." },
  { key: "mooc", label: "MOOC opted", hint: "Students whose MOOC choice is approved." },
  { key: "not_opted", label: "Not opted", hint: "Students who have not chosen MOOC or Minor yet. Select rows to remove or exempt them." },
  { key: "allocations", label: "Minor allocations", hint: "Every Minor request and its outcome. Admin actions work even while allocations are frozen and are logged." },
  { key: "exempt", label: "Exempt", hint: "Students exempted from MOOC and Minor. Undo returns them to Not opted." },
  { key: "removed", label: "Removed", hint: "Students removed from the portal (login disabled). Restore brings them back as Not opted." },
];

export function StudentsClient({ initialTab = "section" }: { initialTab?: StudentsTab }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [tab, setTab] = React.useState<StudentsTab>(initialTab);
  const [sections, setSections] = React.useState<SectionRow[]>([]);
  const [section, setSection] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    void supabase.rpc("admin_sections").then(({ data, error }) => {
      if (error) return void toast.error(error.message);
      const rows = (data ?? []) as SectionRow[];
      setSections(rows);
      setSection((cur) => cur || rows[0]?.section || "");
    });
  }, [supabase]);

  useRealtime([{ table: "students" }], () => setRefresh((n) => n + 1));

  const current = sections.find((s) => s.section === section);
  const active = TABS.find((t) => t.key === tab)!;
  const bump = () => setRefresh((n) => n + 1);

  return (
    <>
      <PageHeader title="Students" description="Every student list in one place. Each tab has its own Excel download." />

      <div role="tablist" aria-label="Student lists" className="mb-2 flex flex-wrap gap-1 rounded-xl bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn("cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{active.hint}</p>

      {tab === "section" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label htmlFor="section-view" className="text-sm font-medium">
              Section
            </label>
            <Select id="section-view" value={section} onChange={(e) => setSection(e.target.value)} className="w-44">
              {sections.map((s) => (
                <option key={s.section} value={s.section}>
                  {s.section} ({s.student_count})
                </option>
              ))}
            </Select>
            {section && (
              <span className="text-sm text-muted-foreground">
                Faculty Advisor: <span className="font-medium text-foreground">{current?.fa_name ?? "—"}</span>
                {current?.fa_emp_id && <span className="ml-1 font-mono text-xs">({current.fa_emp_id})</span>}
              </span>
            )}
          </div>
          {section ? <ClassOverview section={section} refreshKey={refresh} /> : <p className="text-sm text-muted-foreground">No sections yet. Import students first.</p>}
        </>
      )}

      {tab === "allocations" && <AllocationsClient embedded />}

      {tab !== "section" && tab !== "allocations" && <StudentList kind={tab} refreshKey={refresh} onChanged={bump} />}
    </>
  );
}
