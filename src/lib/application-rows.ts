/** Pure helper behind the faculty "Applications" page: one row per formed batch (team). */
import type { BatchRow } from "./types";

export interface ApplicationRecord {
  student1_id: string;
  student2_id: string | null;
  project_title: string | null;
  sdg_goal: string | null;
  problem_by_guide: boolean | null;
  student1_mobile: string | null;
  student2_mobile: string | null;
  status: "draft" | "submitted";
}

export interface TeamApplicationRow {
  batchNo: number;
  members: { name: string; regNo: string; mobile: string }[];
  title: string;
  sdg: string;
  problem: string;
  /** "Draft", "Submitted", or "Not started" when the team has not saved the form yet */
  status: "Draft" | "Submitted" | "Not started";
}

export function buildApplicationRows(
  batches: BatchRow[],
  students: Record<string, { name: string; reg_no: string }>,
  applications: ApplicationRecord[],
): TeamApplicationRow[] {
  return [...batches]
    .filter((b) => b.batch_members.length === 2)
    .sort((a, b) => a.batch_no - b.batch_no)
    .map((b) => {
      const members = [...b.batch_members].sort((x, y) => x.slot - y.slot);
      const app = applications.find((a) => members.some((m) => m.student_id === a.student1_id || m.student_id === a.student2_id));
      return {
        batchNo: b.batch_no,
        members: members.map((m) => ({
          name: students[m.student_id]?.name ?? "",
          regNo: students[m.student_id]?.reg_no ?? "",
          // each student's own mobile: Student 1 of the form owns student1_mobile, the partner owns student2_mobile
          mobile: (app && (m.student_id === app.student1_id ? app.student1_mobile : app.student2_mobile)) || "",
        })),
        title: app?.project_title ?? "",
        sdg: app?.sdg_goal ?? "",
        problem: app?.problem_by_guide == null ? "" : app.problem_by_guide ? "Yes" : "No",
        status: !app ? "Not started" : app.status === "submitted" ? "Submitted" : "Draft",
      };
    });
}
