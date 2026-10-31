"use client";

import * as React from "react";
import { PageHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { MoocReviews } from "./mooc-reviews";
import { useRealtime } from "@/lib/hooks";
import { ClassOverview } from "@/components/class-overview";

export function AdvisorClient({ sections }: { sections: string[] }) {
  const [section, setSection] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const bump = React.useCallback(() => setRefresh((n) => n + 1), []);
  useRealtime([{ table: "mooc_requests" }, { table: "students" }], bump);
  return (
    <>
      <PageHeader
        title="Faculty Advisor"
        description="Review MOOC requests and CGPAs, and track MOOC and Minor choices for the students assigned to you as Faculty Advisor."
        actions={
          sections.length > 1 ? (
            <Select aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)} className="w-40">
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  Section {s}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />
      <MoocReviews key={section} section={section} refreshKey={refresh} onChanged={bump} />
      <h2 className="mb-4 text-lg font-semibold">Class overview</h2>
      <ClassOverview section={section} refreshKey={refresh} />
    </>
  );
}
