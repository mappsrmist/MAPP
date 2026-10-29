/** Pure helpers shared by the on-screen preview and the Excel exports of the batch sheet. */
import type { BatchMemberRow, RequestDetail } from "./types";

export const BATCH_FILLS = ["E2F0D9", "FBE5D6", "DDEBF7", "E4DFEC"]; // green, orange, blue, purple (pastel)
export const HEADER_FILL = "BDD7EE"; // light blue

export const BATCH_COLUMNS = [
  "Batch No.",
  "Name",
  "Registration No.",
  "Section",
  "Faculty Advisor Name",
  "Phone No.",
  "SRM Mail ID",
  "Student Mobile No.",
  "Project Title",
  "Guide Name",
] as const;

/** Admin sheets lead with the guide: Emp ID, then the batch columns. */
export const GUIDE_EMP_COLUMN = "Guide Emp ID";

export interface GuideInfo {
  name: string;
  empId: string;
}

/** The title row above the table: `Guide: <name> — Emp ID: <id>`. */
export const guideTitle = (g: GuideInfo) => `Guide: ${g.name} — Emp ID: ${g.empId}`;

/** The application columns the sheets need (a faculty reads them straight from `applications`). */
export interface ApplicationLite {
  student1_id: string;
  student2_id: string | null;
  student1_mobile: string | null;
  student2_mobile: string | null;
  project_title: string | null;
}

export interface BatchInput {
  batch_no: number;
  batch_members: BatchMemberRow[];
}

export interface SheetRow {
  batchNo: number;
  batchLabel: string;
  name: string;
  regNo: string;
  section: string;
  advisor: string;
  phone: string;
  mail: string;
  studentMobile: string;
  projectTitle: string;
  guideName: string;
  guideEmpId: string;
  /** first row of a 2-row batch (the Batch No. cell is merged over both rows) */
  first: boolean;
}

/** Two rows per grouped batch, ordered by batch number then slot. Each row uses that student's own values. */
export function buildSheetRows(
  batches: BatchInput[],
  students: Record<string, { name: string; reg_no: string }>,
  guideName: string,
  extras: { empId?: string; applications?: ApplicationLite[] } = {},
): SheetRow[] {
  const rows: SheetRow[] = [];
  [...batches]
    .sort((a, b) => a.batch_no - b.batch_no)
    .forEach((b) => {
      const members = [...b.batch_members].sort((x, y) => x.slot - y.slot);
      if (members.length !== 2) return;
      // Grouping can combine students from different application teams.
      members.forEach((m, i) => {
        const st = students[m.student_id];
        const studentApp = (extras.applications ?? []).find((a) => m.student_id === a.student1_id || m.student_id === a.student2_id);
        rows.push({
          batchNo: b.batch_no,
          batchLabel: `B${b.batch_no}`,
          name: st?.name ?? "",
          regNo: st?.reg_no ?? "",
          section: m.section,
          advisor: m.advisor_name,
          phone: m.contact_number,
          mail: m.srm_mail,
          studentMobile: studentApp ? ((m.student_id === studentApp.student1_id ? studentApp.student1_mobile : studentApp.student2_mobile) ?? "") : "",
          projectTitle: studentApp?.project_title ?? "",
          guideName,
          guideEmpId: extras.empId ?? "",
          first: i === 0,
        });
      });
    });
  return rows;
}

export const fillForBatch = (batchNo: number) => BATCH_FILLS[(batchNo - 1) % BATCH_FILLS.length];

export interface GuideSheet {
  facultyId: string;
  guide: GuideInfo;
  rows: SheetRow[];
}

/** Builds one sheet per faculty from flat allocation rows (admin export). Only complete 2-student batches count. */
export function sheetsFromDetails(details: RequestDetail[]): GuideSheet[] {
  const byFaculty = new Map<string, RequestDetail[]>();
  details
    .filter((d) => d.status === "accepted" && d.batch_id && d.batch_no && d.slot && d.advisor_name)
    .forEach((d) => byFaculty.set(d.faculty_id, [...(byFaculty.get(d.faculty_id) ?? []), d]));

  // request_details_v already carries each student's own mobile and their team's title
  return [...byFaculty.entries()]
    .map(([facultyId, list]) => {
      const byReg = new Map(list.map((d) => [d.reg_no, d]));
      const first = list[0];
      const batches = new Map<number, BatchInput>();
      const students: Record<string, { name: string; reg_no: string }> = {};
      list.forEach((d) => {
        students[d.student_id] = { name: d.student_name, reg_no: d.reg_no };
        const b = batches.get(d.batch_no!) ?? { batch_no: d.batch_no!, batch_members: [] };
        b.batch_members.push({
          slot: d.slot!,
          student_id: d.student_id,
          section: d.member_section ?? "",
          advisor_name: d.advisor_name ?? "",
          contact_number: d.contact_number ?? "",
          srm_mail: d.srm_mail ?? "",
        });
        batches.set(d.batch_no!, b);
      });
      return {
        facultyId,
        guide: { name: first.faculty_name, empId: first.faculty_emp_id },
        rows: buildSheetRows([...batches.values()], students, first.faculty_name, { empId: first.faculty_emp_id }).map((r) => ({
          ...r,
          studentMobile: byReg.get(r.regNo)?.student_mobile ?? "",
          projectTitle: byReg.get(r.regNo)?.project_title ?? "",
        })),
      };
    })
    .filter((s) => s.rows.length > 0)
    .sort((a, b) => a.guide.empId.localeCompare(b.guide.empId, undefined, { numeric: true }));
}
