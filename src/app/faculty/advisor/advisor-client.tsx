"use client";

import * as React from "react";
import { PageHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { ClassOverview } from "@/components/class-overview";

export function AdvisorClient({ sections }: { sections: string[] }) {
  const [section, setSection] = React.useState(sections[0]);
  return (
    <>
      <PageHeader
        title="Faculty Advisor"
        description="Your class: every student of your section(s) and where they stand on MOOC and Minor. Read-only."
        actions={
          sections.length > 1 ? (
            <Select aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)} className="w-40">
              {sections.map((s) => (
                <option key={s} value={s}>
                  Section {s}
                </option>
              ))}
            </Select>
          ) : (
            <span className="rounded-lg bg-muted px-3 py-2 text-sm font-medium">Section {sections[0]}</span>
          )
        }
      />
      <ClassOverview section={section} />
    </>
  );
}
