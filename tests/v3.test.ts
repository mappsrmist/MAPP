import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import { resolveLogin } from "@/lib/auth-utils";
import { loginKeys } from "@/lib/server/throttle";
import { BATCH_COLUMNS, GUIDE_EMP_COLUMN, buildSheetRows, guideTitle, sheetsFromDetails } from "@/lib/batch-sheet";
import { buildBatchWorkbook } from "@/lib/excel";
import { IMPORT_HEADERS } from "@/lib/import-excel";
import { facultyRowSchema, studentRowSchema, importRequestSchema, loginSchema, studentActionSchema } from "@/lib/validators";
import type { RequestDetail } from "@/lib/types";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("admin sign-in goes through the Faculty tab", () => {
  it("resolves the admin username on the Faculty tab to the admin account only", () => {
    expect(resolveLogin("faculty", "mappCtech")).toEqual({ role: "admin", email: "admin@mapp.local" });
    expect(resolveLogin("faculty", "  MAPPCTECH ").role).toBe("admin");
    expect(resolveLogin("faculty", "Priya@SRMIST.edu.in")).toEqual({ role: "faculty", email: "priya@srmist.edu.in" });
  });
  it("never lets the Student tab reach the admin account", () => {
    const t = resolveLogin("student", "mappCtech");
    expect(t.role).toBe("student");
    expect(t.email).toBe("mappctech@students.mapp.local");
    expect(t.email).not.toBe("admin@mapp.local");
  });
  it("has no admin role on the login form", () => {
    expect(loginSchema.safeParse({ role: "admin", username: "mappCtech", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ role: "faculty", username: "mappCtech", password: "x" }).success).toBe(true);
    expect(read("src/app/login/page.tsx")).not.toMatch(/Admin/);
  });
  it("applies a stricter lockout to the admin account, shared by every alias", () => {
    const admin = loginKeys("admin", "mappCtech", "1.1.1.1");
    const normal = loginKeys("faculty", "a@srmist.edu.in", "1.1.1.1");
    expect(admin[0].max).toBeLessThan(normal[0].max);
    expect(admin[1].max).toBeLessThan(normal[1].max);
    expect(loginKeys("admin", "MAPPCTECH", "1.1.1.1")).toEqual(admin);
  });
  it("returns one generic error for wrong user and wrong password", () => {
    const route = read("src/app/api/auth/login/route.ts");
    expect(route.match(/Invalid username or password/g)).toHaveLength(1);
    // no response string hints that an admin account exists
    const messages = [...route.matchAll(/error: [`"]([^`"]*)[`"]/g)].map((m) => m[1]);
    expect(messages.length).toBeGreaterThan(0);
    messages.forEach((m) => expect(m).not.toMatch(/admin/i));
  });
});

describe("imports", () => {
  it("faculty import has no designation and keeps cadre", () => {
    expect(IMPORT_HEADERS.faculty).toEqual(["Emp ID", "Name", "SRM Email", "Phone", "Venue", "Domains", "Cadre"]);
    expect(IMPORT_HEADERS.students).toEqual(["Reg No", "Name", "Dept", "Section", "Email", "FA Email"]);
    const row = { emp_id: "600323", name: "X", srm_email: "x@srmist.edu.in", cadre: "OTHER" };
    expect(facultyRowSchema.safeParse(row).success).toBe(true);
    expect(facultyRowSchema.safeParse({ ...row, designation: "Prof" }).success).toBe(false);
    expect(importRequestSchema.safeParse({ type: "faculty", rows: [{ ...row, designation: "P" }] }).success).toBe(false);
    expect(importRequestSchema.safeParse({ type: "faculty", rows: [row], rowNumbers: [7] }).success).toBe(true);
  });
  it("validates the student's Faculty Advisor email", () => {
    const row = { reg_no: "RA2400000000000", name: "A", dept: "CSE", section: "A" };
    expect(studentRowSchema.parse({ ...row, fa_email: " Priya@SRMIST.edu.in " }).fa_email).toBe("priya@srmist.edu.in");
    expect(studentRowSchema.parse(row).fa_email).toBeNull();
    expect(studentRowSchema.parse({ ...row, fa_email: "" }).fa_email).toBeNull();
    expect(studentRowSchema.safeParse({ ...row, fa_email: "not-an-email" }).success).toBe(false);
    expect(importRequestSchema.safeParse({ type: "students", rows: [{ ...row, fa_email: "p@srmist.edu.in" }] }).success).toBe(true);
    expect(importRequestSchema.safeParse({ type: "advisors", rows: [{ emp_id: "600323", section: "A" }] }).success).toBe(false);
  });
  it("validates the student remove / restore request", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(studentActionSchema.safeParse({ action: "remove", ids: [id] }).success).toBe(true);
    expect(studentActionSchema.safeParse({ action: "delete", ids: [id] }).success).toBe(false); // hard delete is not offered
    expect(studentActionSchema.safeParse({ action: "remove", ids: [] }).success).toBe(false);
    expect(studentActionSchema.safeParse({ action: "remove", ids: ["x"] }).success).toBe(false);
  });
});

describe("batch sheet: Project Title and Student Mobile No.", () => {
  const people = { a: { name: "A", reg_no: "RA1" }, b: { name: "B", reg_no: "RA2" } };
  const m = (slot: number, student_id: string) => ({ slot, student_id, section: "A1", advisor_name: "Dr FA", contact_number: "9", srm_mail: "x@srmist.edu.in" });
  const batches = [{ batch_no: 1, batch_members: [m(1, "a"), m(2, "b")] }];

  it("uses the required column order", () => {
    expect([...BATCH_COLUMNS]).toEqual([
      "Batch No.", "Name", "Registration No.", "Section", "Faculty Advisor Name", "Phone No.", "SRM Mail ID", "Student Mobile No.", "Project Title", "Guide Name",
    ]);
  });
  it("gives each student their own mobile, repeats the title, and leaves blanks when the form is not filled", () => {
    const app = { student1_id: "b", student2_id: "a", student1_mobile: "9000000002", student2_mobile: "9000000001", project_title: "Smart Campus" };
    const rows = buildSheetRows(batches, people, "Guide", { applications: [app] });
    expect(rows.map((r) => r.studentMobile)).toEqual(["9000000001", "9000000002"]);
    expect(rows.map((r) => r.projectTitle)).toEqual(["Smart Campus", "Smart Campus"]);
    const empty = buildSheetRows(batches, people, "Guide");
    expect(empty.map((r) => [r.studentMobile, r.projectTitle])).toEqual([["", ""], ["", ""]]);
  });
  it("writes the title merged over both rows of the batch, and no cadre in the title row", async () => {
    const rows = buildSheetRows(batches, people, "Guide", { empId: "E1", applications: [{ student1_id: "a", student2_id: "b", student1_mobile: "1", student2_mobile: "2", project_title: "=Evil()" }] });
    const wb = await buildBatchWorkbook([{ name: "S", title: guideTitle({ name: "Guide", empId: "E1" }), rows }]);
    const ExcelJS = (await import("exceljs")).default;
    const back = new ExcelJS.Workbook();
    await back.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const ws = back.getWorksheet("S")!;
    expect(ws.getCell("A1").value).toBe("Guide: Guide — Emp ID: E1");
    expect(ws.getCell("H3").value).toBe("1");
    expect(ws.getCell("H4").value).toBe("2");
    expect(ws.getCell("I3").value).toBe("'=Evil()");
    expect(ws.getCell("I4").master.address).toBe("I3"); // Project Title merged like Batch No.
    expect(ws.getCell("A4").master.address).toBe("A3");
  });
  it("admin sheets lead with the guide Emp ID, ordered by employee ID", async () => {
    const det = (o: Partial<RequestDetail>): RequestDetail => ({
      id: "r", status: "accepted", project_type: "minor", created_at: "", responded_at: null, faculty_id: "f1", faculty_emp_id: "E2",
      faculty_name: "Zed", faculty_cadre: "OTHER", faculty_frozen: false, student_id: "s", reg_no: "RA1", student_name: "S",
      dept: "CSE", student_section: "A", student_email: null, batch_id: "b1", batch_no: 1, slot: 1, member_section: "A",
      advisor_name: "Adv", contact_number: "9", srm_mail: "a@srmist.edu.in", section: "A", display_status: "grouped",
      project_title: "Title", student_mobile: "9000000009", fa_name: "Adv", ...o,
    });
    const sheets = sheetsFromDetails([
      det({ faculty_id: "f1", student_id: "s1", reg_no: "RA1", slot: 1 }),
      det({ faculty_id: "f1", student_id: "s2", reg_no: "RA2", slot: 2, student_mobile: "9000000008" }),
      det({ faculty_id: "f2", faculty_emp_id: "E1", faculty_name: "Alpha", student_id: "s3", reg_no: "RA3", batch_id: "b2", slot: 1 }),
      det({ faculty_id: "f2", faculty_emp_id: "E1", faculty_name: "Alpha", student_id: "s4", reg_no: "RA4", batch_id: "b2", slot: 2 }),
    ]);
    expect(sheets.map((s) => s.guide.empId)).toEqual(["E1", "E2"]);
    expect(sheets[1].rows.map((r) => [r.studentMobile, r.projectTitle])).toEqual([["9000000009", "Title"], ["9000000008", "Title"]]);
    const wb = await buildBatchWorkbook([{ name: "All", title: "All", rows: sheets.flatMap((s) => s.rows), leadEmpId: true }]);
    const ws = wb.getWorksheet("All")!;
    expect(ws.getRow(2).values).toEqual([undefined, GUIDE_EMP_COLUMN, ...BATCH_COLUMNS]);
    expect(ws.getCell("A3").value).toBe("E1");
    expect(ws.getCell("K3").value).toBe("Alpha");
  });
});

describe("overview and no-designation checks", () => {
  it("shows department and designation on the application and PDF", () => {
    expect(read("src/app/student/application/application-client.tsx")).toContain("Department / Designation");
    expect(read("src/lib/application-pdf.ts")).toContain("Department / Designation");
  });
  it("overview includes pending MOOC separately from approved and unselected students", () => {
    const o = read("src/app/admin/overview-client.tsx");
    for (const label of ["Total Students", "Total Faculty", "Minor", "MOOC Opted", "MOOC pending", "Not Opted"]) expect(o).toContain(label);
    expect(o).not.toMatch(/Filter|filter|Dept|Department|total_seats|accepted|declined/);
    const list = read("src/app/admin/student-list.tsx");
    expect(list).toContain("Faculty Advisor Name");
    expect(list).toContain("Student SRM Mail");
    expect(list).not.toMatch(/Dept|Department|Filter/);
  });
  it("the Faculty Advisor page is gated server-side and the nav item is conditional", () => {
    expect(read("src/app/faculty/advisor/page.tsx")).toMatch(/is_faculty_advisor[\s\S]*notFound\(\)/);
    expect(read("src/app/faculty/layout.tsx")).toMatch(/isAdvisor \? \[/);
  });
});
