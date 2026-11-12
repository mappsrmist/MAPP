import "server-only";
import { fetchAll } from "@/lib/fetch-all";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCell } from "@/lib/excel";

type Row = Record<string, unknown>;

/** READ-ONLY: only SELECTs. Nothing here inserts, updates or deletes. */
async function readTable(admin: ReturnType<typeof createAdminClient>, table: string, order: string): Promise<Row[]> {
  return fetchAll<Row>((from, to) => admin.from(table).select("*").order(order, { ascending: true }).range(from, to));
}

const pretty = (v: unknown): string | number | boolean | Date => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace("T", " ").replace(/(\.\d+)?(\+00:00|Z)$/, " UTC");
  return v as string | number | boolean;
};

/** Builds the complete master workbook (Students, Faculty, Requests, Batches, Applications, MOOC, Advisors). */
export async function buildMasterWorkbook(): Promise<ArrayBuffer> {
  const admin = createAdminClient();
  const [profiles, students, faculty, requests, batches, members, applications, mooc, advisors] = await Promise.all([
    readTable(admin, "profiles", "id"),
    readTable(admin, "students", "id"),
    readTable(admin, "faculty", "id"),
    readTable(admin, "requests", "id"),
    readTable(admin, "batches", "id"),
    readTable(admin, "batch_members", "batch_id"),
    readTable(admin, "applications", "id"),
    readTable(admin, "mooc_requests", "id"),
    readTable(admin, "faculty_advisors", "id"),
  ]);

  const username = new Map(profiles.map((p) => [p.id as string, p.username as string]));
  const mustChange = new Map(profiles.map((p) => [p.id as string, p.must_change_password as boolean]));
  const stu = new Map(students.map((s) => [s.id as string, s]));
  const fac = new Map(faculty.map((f) => [f.id as string, f]));
  const bat = new Map(batches.map((b) => [b.id as string, b]));
  const sName = (id: unknown) => (stu.get(id as string)?.name as string) ?? "";
  const sReg = (id: unknown) => (stu.get(id as string)?.reg_no as string) ?? "";
  const fName = (id: unknown) => (fac.get(id as string)?.name as string) ?? "";
  const fEmp = (id: unknown) => (fac.get(id as string)?.emp_id as string) ?? "";

  const memberOf = new Map<string, Row>();
  members.forEach((m) => memberOf.set(`${m.student_id}:${m.project_type}`, m));
  const reqByStudent = new Map<string, Row[]>();
  requests.forEach((r) => reqByStudent.set(r.student_id as string, [...(reqByStudent.get(r.student_id as string) ?? []), r]));
  const batchesByFaculty = new Map<string, Row[]>();
  batches.forEach((b) => batchesByFaculty.set(b.faculty_id as string, [...(batchesByFaculty.get(b.faculty_id as string) ?? []), b]));
  const appByStudent = new Map<string, Row>();
  applications.forEach((a) => {
    appByStudent.set(a.student1_id as string, a);
    if (a.student2_id) appByStudent.set(a.student2_id as string, a);
  });
  const advisorFor = new Map(advisors.map((a) => [String(a.section).toUpperCase(), a]));

  const studentRows: Row[] = students.map((s) => {
    const minor = memberOf.get(`${s.id}:minor`);
    const batch = minor ? bat.get(minor.batch_id as string) : undefined;
    const adv = advisorFor.get(String(s.section ?? "").trim().toUpperCase());
    const app = appByStudent.get(s.id as string);
    const myReqs = reqByStudent.get(s.id as string) ?? [];
    const fa = s.fa_id ? fac.get(s.fa_id as string) : undefined;
    return {
      reg_no: s.reg_no, name: s.name, dept: s.dept, section: s.section, email: s.email,
      login_username: username.get(s.id as string), must_change_password: mustChange.get(s.id as string),
      choice: s.choice, choice_at: s.choice_at, mooc_cgpa: s.mooc_cgpa, is_active: s.is_active,
      faculty_advisor_name: (fa?.name as string) ?? (adv ? fName(adv.faculty_id) : ""),
      faculty_advisor_emp_id: (fa?.emp_id as string) ?? (adv ? fEmp(adv.faculty_id) : ""),
      minor_faculty_name: batch ? fName(batch.faculty_id) : "", minor_faculty_emp_id: batch ? fEmp(batch.faculty_id) : "",
      minor_batch_no: batch?.batch_no, minor_slot: minor?.slot,
      requests_total: myReqs.length,
      requests_summary: myReqs.map((r) => `${fName(r.faculty_id)} (${r.status})`).join("; "),
      application_status: app?.status, application_title: app?.project_title,
      created_at: s.created_at, updated_at: s.updated_at, student_id: s.id,
    };
  });

  const facultyRows: Row[] = faculty.map((f) => {
    const fb = batchesByFaculty.get(f.id as string) ?? [];
    return {
      emp_id: f.emp_id, name: f.name, srm_email: f.srm_email, login_username: username.get(f.id as string),
      must_change_password: mustChange.get(f.id as string), dob: f.dob, designation: f.designation, department: f.department,
      cadre: f.cadre, phone: f.phone, venue: f.venue, domains: f.domains,
      total_seats: f.total_seats, accepted_count: f.accepted_count, available_seats: f.available_seats, frozen: f.frozen,
      batches_total: fb.length,
      batches_full: fb.filter((b) => members.filter((m) => m.batch_id === b.id).length === 2).length,
      advisor_sections: advisors.filter((a) => a.faculty_id === f.id).map((a) => a.section).join(", "),
      created_at: f.created_at, updated_at: f.updated_at, faculty_id: f.id,
    };
  });

  const requestRows: Row[] = requests.map((r) => ({
    student_reg_no: sReg(r.student_id), student_name: sName(r.student_id),
    faculty_emp_id: fEmp(r.faculty_id), faculty_name: fName(r.faculty_id),
    project_type: r.project_type, status: r.status, created_at: r.created_at, responded_at: r.responded_at, request_id: r.id,
  }));

  const batchRows: Row[] = members.map((m) => {
    const b = bat.get(m.batch_id as string);
    return {
      faculty_emp_id: fEmp(b?.faculty_id), faculty_name: fName(b?.faculty_id), project_type: m.project_type,
      batch_no: b?.batch_no, section: b?.section, slot: m.slot, student_reg_no: sReg(m.student_id), student_name: sName(m.student_id),
      advisor_name: b?.advisor_name, contact_number: b?.contact_number, srm_mail: b?.srm_mail,
    };
  });

  const applicationRows: Row[] = applications.map((a) => ({
    faculty_emp_id: fEmp(a.faculty_id), faculty_name: fName(a.faculty_id),
    student1_reg_no: sReg(a.student1_id), student1_name: sName(a.student1_id), student1_mail: a.student1_mail, student1_mobile: a.student1_mobile,
    student2_reg_no: a.student2_reg ?? sReg(a.student2_id), student2_name: a.student2_name ?? sName(a.student2_id),
    student2_section: a.student2_section, student2_mail: a.student2_mail, student2_mobile: a.student2_mobile,
    project_title: a.project_title, sdg_goal: a.sdg_goal, problem_by_guide: a.problem_by_guide, project_type: a.project_type,
    status: a.status, created_at: a.created_at, updated_at: a.updated_at,
  }));

  const moocRows: Row[] = mooc.map((m) => ({
    student_reg_no: sReg(m.student_id), student_name: sName(m.student_id), cgpa: m.cgpa, status: m.status,
    requested_at: m.requested_at, reviewed_at: m.reviewed_at,
  }));

  const advisorRows: Row[] = advisors.map((a) => ({ section: a.section, faculty_emp_id: fEmp(a.faculty_id), faculty_name: fName(a.faculty_id) }));

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const sheets: [string, Row[]][] = [
    ["Students", studentRows], ["Faculty", facultyRows], ["Requests", requestRows], ["Batches", batchRows],
    ["Applications", applicationRows], ["MOOC", moocRows], ["Faculty Advisors", advisorRows],
  ];
  for (const [name, rows] of sheets) {
    const ws = wb.addWorksheet(name);
    const keys = rows.length ? Object.keys(rows[0]) : ["(no rows)"];
    ws.columns = keys.map((k) => ({ header: k.replace(/_/g, " ").toUpperCase(), key: k, width: Math.min(40, Math.max(14, k.length + 4)) }));
    rows.forEach((r) => ws.addRow(Object.fromEntries(keys.map((k) => [k, safeCell(pretty(r[k]))]))));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
