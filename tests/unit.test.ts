import { describe, expect, it } from "vitest";
import { normalizeRegNo, usernameToEmail } from "@/lib/auth-utils";
import { APPROACHED_HEADERS, SDG_GOALS, batchesForCadre, seatsForCadre } from "@/lib/config";
import { BATCH_COLUMNS, buildSheetRows, fillForBatch, guideTitle, sheetsFromDetails } from "@/lib/batch-sheet";
import { buildApplicationPdf } from "@/lib/application-pdf";
import type { ApplicationForm, RequestDetail } from "@/lib/types";
import { buildBatchWorkbook, safeCell } from "@/lib/excel";
import { SDG_PATTERN, applicationSubmitSchema, batchFormSchema, changePasswordSchema, facultyRowSchema, studentRowSchema } from "@/lib/validators";

describe("cadre -> seats / batches (e)", () => {
  it("matches the MAPP spec", () => {
    expect([seatsForCadre("HOD"), seatsForCadre("ASSOC_CHAIR"), seatsForCadre("OTHER")]).toEqual([6, 4, 8]);
    expect([batchesForCadre("HOD"), batchesForCadre("ASSOC_CHAIR"), batchesForCadre("OTHER")]).toEqual([3, 2, 4]);
  });
});

describe("login mapping", () => {
  it("normalises reg numbers and maps usernames to auth emails", () => {
    expect(normalizeRegNo("  ra2411003010058 ")).toBe("RA2411003010058");
    expect(usernameToEmail("student", " ra2411003010058")).toBe("ra2411003010058@students.mapp.local");
    expect(usernameToEmail("faculty", " Priya@SRMIST.edu.in ")).toBe("priya@srmist.edu.in");
    expect(usernameToEmail("admin", "mappCtech")).toBe("admin@mapp.local");
    expect(usernameToEmail("admin", "admin")).toBeNull();
    expect(usernameToEmail("admin", "admin@mapp.local")).toBeNull();
    expect(usernameToEmail("admin", "someone")).toBeNull();
  });
});

describe("validation", () => {
  it("accepts a student row and uppercases the reg no", () => {
    const r = studentRowSchema.parse({ reg_no: " ra2411003010058", name: "A", dept: "CSE", section: "A" });
    expect(r.reg_no).toBe("RA2411003010058");
    expect(r.section).toBe("A");
  });
  it("requires a section on every imported student", () => {
    expect(studentRowSchema.safeParse({ reg_no: "RA2411003010058", name: "A", dept: "CSE" }).success).toBe(false);
    expect(studentRowSchema.safeParse({ reg_no: "RA2411003010058", name: "A", dept: "CSE", section: " " }).success).toBe(false);
  });
  it("rejects reg numbers that could not be a safe login name", () => {
    expect(studentRowSchema.safeParse({ reg_no: "RA24 110030", name: "A", dept: "CSE", section: "A" }).success).toBe(false);
    expect(studentRowSchema.safeParse({ reg_no: "a@b.c", name: "A", dept: "CSE", section: "A" }).success).toBe(false);
  });
  it("needs an employee ID long enough to be the initial password", () => {
    const row = { emp_id: "E1", name: "X", srm_email: "x@srmist.edu.in", cadre: "OTHER" };
    expect(facultyRowSchema.safeParse(row).success).toBe(false);
    expect(facultyRowSchema.safeParse({ ...row, emp_id: "600323" }).success).toBe(true);
  });
  it("accepts a faculty row and normalises cadre/domains", () => {
    const r = facultyRowSchema.parse({
      emp_id: "600323", name: "X", srm_email: "X@SRMIST.EDU.IN",
      cadre: "associate chair", domains: "AI; ML ;",
    });
    expect(r.cadre).toBe("ASSOC_CHAIR");
    expect(r.domains).toEqual(["AI", "ML"]);
    expect(r.srm_email).toBe("x@srmist.edu.in");
  });
  it("rejects bad rows", () => {
    expect(facultyRowSchema.safeParse({ emp_id: "600323", name: "X", srm_email: "nope", cadre: "BOSS" }).success).toBe(false);
    const base = { emp_id: "600323", name: "X", cadre: "OTHER" };
    expect(facultyRowSchema.safeParse({ ...base, srm_email: "ra1@students.mapp.local" }).success).toBe(false);
    expect(facultyRowSchema.safeParse({ ...base, srm_email: "admin@mapp.local" }).success).toBe(false);
  });
  it("password change must differ from the old one and meet the strength policy", () => {
    const cur = "Abcdefgh12";
    expect(changePasswordSchema.safeParse({ currentPassword: cur, newPassword: cur }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: cur, newPassword: "short1" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: cur, newPassword: "onlyletterslong" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: cur, newPassword: "1234567890123" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: cur, newPassword: "BlueTiger2026x" }).success).toBe(true);
  });
  it("validates the batch form per student", () => {
    const m = { student: "a", section: "A", advisor: "Dr X", contact: "98765 43210", mail: "x@srmist.edu.in" };
    const ok = { m1: m, m2: { ...m, student: "b", section: "B" } };
    const parsed = batchFormSchema.parse(ok);
    expect(parsed.m1.contact).toBe("9876543210");
    expect(parsed.m2.section).toBe("B");
    expect(batchFormSchema.safeParse({ ...ok, m2: { ...ok.m2, student: "a" } }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...ok, m2: { ...ok.m2, contact: "123" } }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...ok, m1: { ...ok.m1, mail: "nope" } }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...ok, m1: { ...ok.m1, section: "" } }).success).toBe(false);
  });
});

describe("faculty approached table", () => {
  it("shows Section instead of Dept", () => {
    expect([...APPROACHED_HEADERS]).toEqual(["Reg No", "Name", "Section", "Status", "Accept", "Decline"]);
    expect(APPROACHED_HEADERS).not.toContain("Dept");
  });
});

describe("application form validation", () => {
  const ok = {
    title: "Smart Campus", sdg: "1. No Poverty", problem: "yes", s1_mail: "a@srmist.edu.in", s1_mobile: "98765 43210",
    s2_name: "B", s2_reg: "ra2411003010059", s2_section: "A", s2_mail: "b@srmist.edu.in", s2_mobile: "9123456780",
  };
  it("accepts a complete form and normalises numbers / reg no", () => {
    const r = applicationSubmitSchema.parse(ok);
    expect(r.s1_mobile).toBe("9876543210");
    expect(r.s2_reg).toBe("RA2411003010059");
  });
  it("requires an SDG that starts with a number from 1 to 17", () => {
    for (const good of ["1. No Poverty", "17. Partnerships for the Goals", "9 Industry", "13) Climate Action"]) expect(SDG_PATTERN.test(good)).toBe(true);
    for (const bad of ["No Poverty", "0. Nothing", "18. Nothing", "100. Nothing", "1.", "1"]) expect(SDG_PATTERN.test(bad)).toBe(false);
    expect(SDG_GOALS).toHaveLength(17);
    SDG_GOALS.forEach((g) => expect(SDG_PATTERN.test(g)).toBe(true));
  });
  it("rejects bad mobile numbers, non-SRM partner mail and a missing Yes/No", () => {
    expect(applicationSubmitSchema.safeParse({ ...ok, s1_mobile: "12345" }).success).toBe(false);
    expect(applicationSubmitSchema.safeParse({ ...ok, s2_mail: "b@gmail.com" }).success).toBe(false);
    expect(applicationSubmitSchema.safeParse({ ...ok, problem: "" }).success).toBe(false);
    expect(applicationSubmitSchema.safeParse({ ...ok, s2_reg: "x y" }).success).toBe(false);
  });
});

describe("excel safety + batch sheet", () => {
  it("neutralises formula injection", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("+1")).toBe("'+1");
    expect(safeCell("-2")).toBe("'-2");
    expect(safeCell("@cmd")).toBe("'@cmd");
    expect(safeCell("normal")).toBe("normal");
    expect(safeCell(5)).toBe(5);
  });
  const member = (slot: number, student_id: string, section: string, advisor: string, phone: string, mail: string) => ({
    slot, student_id, section, advisor_name: advisor, contact_number: phone, srm_mail: mail,
  });
  const people = { a: { name: "A", reg_no: "RA1" }, b: { name: "B", reg_no: "RA2" }, c: { name: "C", reg_no: "RA3" }, d: { name: "D", reg_no: "RA4" } };

  it("builds two rows per batch, ordered, with distinct fills, per-student values and the guide name", () => {
    const rows = buildSheetRows(
      [
        { batch_no: 2, batch_members: [member(2, "d", "B2", "Dr Y2", "2", "y2@x"), member(1, "c", "B1", "Dr Y1", "1", "y1@x")] },
        { batch_no: 1, batch_members: [member(1, "a", "A1", "Dr X1", "3", "x1@x"), member(2, "b", "A2", "Dr X2", "4", "x2@x")] },
      ],
      people,
      "Dr Guide",
    );
    expect(rows.map((r) => r.regNo)).toEqual(["RA1", "RA2", "RA3", "RA4"]);
    expect(rows.map((r) => r.first)).toEqual([true, false, true, false]);
    expect(rows[0].batchLabel).toBe("B1");
    expect(rows.map((r) => r.section)).toEqual(["A1", "A2", "B1", "B2"]); // each student keeps their own values
    expect(rows.map((r) => r.advisor)).toEqual(["Dr X1", "Dr X2", "Dr Y1", "Dr Y2"]);
    expect(rows.every((r) => r.guideName === "Dr Guide")).toBe(true);
    expect(fillForBatch(1)).not.toBe(fillForBatch(2));
  });
  it("uses the required column order and guide title", () => {
    expect([...BATCH_COLUMNS]).toEqual(["Batch No.", "Name", "Registration No.", "Section", "Faculty Advisor Name", "Phone No.", "SRM Mail ID", "Student Mobile No.", "Project Title", "Guide Name"]);
    expect(guideTitle({ name: "Deeban", empId: "600323" })).toBe("Guide: Deeban — Emp ID: 600323");
  });
  it("writes the guide title row, the Guide Name column, per-student values and merged batch cells into the xlsx", async () => {
    const rows = buildSheetRows(
      [{ batch_no: 1, batch_members: [member(1, "a", "A1", "=Evil()", "3", "x1@x"), member(2, "b", "A2", "Dr X2", "4", "x2@x")] }],
      people,
      "Deeban",
    );
    const wb = await buildBatchWorkbook([{ name: "Batches", title: guideTitle({ name: "Deeban", empId: "600323" }), rows }]);
    const ExcelJS = (await import("exceljs")).default;
    const back = new ExcelJS.Workbook();
    await back.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const ws = back.getWorksheet("Batches")!;
    expect(ws.getCell("A1").value).toBe("Guide: Deeban — Emp ID: 600323");
    expect(ws.getRow(2).values).toEqual([undefined, ...BATCH_COLUMNS]);
    expect(ws.getCell("J3").value).toBe("Deeban");
    expect(ws.getCell("J4").value).toBe("Deeban");
    expect(ws.getCell("A3").value).toBe("B1");
    expect(ws.getCell("A4").master.address).toBe("A3"); // Batch No. merged over both rows
    expect(ws.getCell("D3").value).toBe("A1");
    expect(ws.getCell("D4").value).toBe("A2");
    expect(ws.getCell("E3").value).toBe("'=Evil()"); // formula injection neutralised
  });
  it("excludes incomplete batches with fewer than 2 students", () => {
    const rows = buildSheetRows([{ batch_no: 1, batch_members: [member(1, "a", "A", "Dr X", "2", "x@x")] }], people, "Dr Guide");
    expect(rows).toEqual([]);
  });
  it("builds one sheet per guide from flat allocation rows (admin export)", () => {
    const det = (o: Partial<RequestDetail>): RequestDetail => ({
      id: "r", status: "accepted", project_type: "minor", created_at: "", responded_at: null, faculty_id: "f1", faculty_emp_id: "E1",
      faculty_name: "Guide One", faculty_cadre: "OTHER", faculty_frozen: false, student_id: "s", reg_no: "RA1", student_name: "S",
      dept: "CSE", student_section: "A", student_email: null, batch_id: "b1", batch_no: 1, slot: 1, member_section: "A",
      advisor_name: "Adv", contact_number: "9876543210", srm_mail: "adv@srmist.edu.in", section: "A", display_status: "grouped",
      project_title: null, student_mobile: null, fa_name: null, ...o,
    });
    const sheets = sheetsFromDetails([
      det({ student_id: "s1", reg_no: "RA1", slot: 1 }),
      det({ student_id: "s2", reg_no: "RA2", slot: 2 }),
      det({ faculty_id: "f2", faculty_name: "Guide Two", student_id: "s3", reg_no: "RA3", batch_id: "b2", slot: 1 }), // incomplete batch
      det({ student_id: "s4", status: "pending", batch_id: null, batch_no: null, slot: null, advisor_name: null }),
    ]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].guide).toEqual({ name: "Guide One", empId: "E1" });
    expect(sheets[0].rows.map((r) => [r.regNo, r.guideName])).toEqual([["RA1", "Guide One"], ["RA2", "Guide One"]]);
  });
});

describe("application PDF", () => {
  const form: ApplicationForm = {
    application_id: "a", status: "submitted", faculty_id: "f", project_title: "Smart Campus ".repeat(12), sdg_goal: "1. No Poverty",
    problem_by_guide: true, s1_name: "அரவிந்த் Kumar", s1_reg: "RA2411003010058", s1_section: "A", s1_mail: "a@srmist.edu.in", s1_mobile: "9876543210",
    s2_name: "B", s2_reg: "RA2411003010059", s2_section: "A", s2_mail: "b@srmist.edu.in", s2_mobile: "9123456780", s2_locked: true,
    guide_name: "Deeban", guide_emp_id: "600323", guide_phone: "9999999999", guide_department: "Computing Technologies", can_edit: false,
  };
  it("produces a PDF even for long titles and names the standard fonts cannot encode", async () => {
    const bytes = await buildApplicationPdf(form);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });
  it("handles an empty draft", async () => {
    const bytes = await buildApplicationPdf({ ...form, status: "draft", project_title: null, sdg_goal: null, problem_by_guide: null, s2_name: null, guide_phone: null });
    expect(bytes.length).toBeGreaterThan(1500);
  });
});
