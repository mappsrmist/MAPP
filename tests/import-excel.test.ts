import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildImportRows, canon, detectLayout, parseImportWorkbook, readImportWorkbook, validateImportFile, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS,
} from "@/lib/import-excel";
import { advisorRowSchema, facultyRowSchema, normalizeCadre, studentRowSchema } from "@/lib/validators";

async function bytesOf(wb: ExcelJS.Workbook) {
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
async function workbook(rows: unknown[][], name = "Sheet1") {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(name);
  rows.forEach((row) => sheet.addRow(row));
  return bytesOf(wb);
}

describe("Excel imports: reading", () => {
  it("only accepts bounded xlsx files", () => {
    expect(() => validateImportFile({ name: "students.xlsx", size: 100 })).not.toThrow();
    expect(() => validateImportFile({ name: "students.csv", size: 100 })).toThrow(/xlsx/i);
    expect(() => validateImportFile({ name: "students.xlsm", size: 100 })).toThrow(/xlsx/i);
    expect(() => validateImportFile({ name: "students.xlsx", size: MAX_IMPORT_BYTES + 1 })).toThrow(/5 MiB/);
  });

  it("reads the template layout and keeps text identifiers", async () => {
    const bytes = await workbook([["Reg No", "Name", "Dept", "Section", "Email"], ["ra001234", " Student ", "CSE", "a", ""], [], [123456, "Other", "CSE", "B"]]);
    expect(await parseImportWorkbook(bytes, "students")).toEqual([
      { reg_no: "RA001234", name: "Student", dept: "CSE", section: "A" },
      { reg_no: "123456", name: "Other", dept: "CSE", section: "B" },
    ]);
  });

  it("still accepts the old snake_case headers", async () => {
    const bytes = await workbook([["reg_no", "name", "dept", "section", "email"], ["RA2411003010058", "A", "CSE", "A", "a@srmist.edu.in"]]);
    expect(await parseImportWorkbook(bytes, "students")).toEqual([{ reg_no: "RA2411003010058", name: "A", dept: "CSE", section: "A", email: "a@srmist.edu.in" }]);
  });

  it("handles a real-world student sheet: title rows, merges, formulas, hyperlinks, extra columns, footer", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("III Year");
    ws.addRow(["SRM Institute of Science and Technology"]);
    ws.mergeCells("A1:G1");
    ws.addRow(["Department of CSE — Student list 2026"]);
    ws.addRow([]);
    ws.addRow(["S.No", "Register Number", "Name of the Student", "Section", "E-Mail ID", "Faculty Advisor Name", "CGPA"]);
    ws.addRow([1, "RA2411003010001", { formula: 'PROPER("asha k")', result: "Asha K" }, "Sec - A", { text: "asha@srmist.edu.in", hyperlink: "mailto:asha@srmist.edu.in" }, "Dr. Ravi", 9.1]);
    ws.addRow([2, "RA 2411003010002", { richText: [{ text: "Bala " }, { text: "M" }] }, null, "bala@srmist.edu.in", "Dr. Ravi", 8.2]);
    ws.mergeCells("D5:D6"); // section written once for the block
    ws.addRow([]);
    ws.addRow(["", "", "Total", "", "", "", 2]);
    const rows = await parseImportWorkbook(await bytesOf(wb), "students");
    expect(rows).toEqual([
      { reg_no: "RA2411003010001", name: "Asha K", dept: "CSE", section: "A", email: "asha@srmist.edu.in" },
      { reg_no: "RA2411003010002", name: "Bala M", dept: "CSE", section: "A", email: "bala@srmist.edu.in" },
    ]);
    rows.forEach((r) => expect(studentRowSchema.safeParse(r).success).toBe(true));
  });

  it("reports real Excel row numbers and skips repeated header blocks", async () => {
    const sheets = await readImportWorkbook(await workbook([
      ["Student list"], ["Reg No", "Name", "Section"], ["RA0000001", "A", "A"], ["Reg No", "Name", "Section"], ["RA0000002", "B", "B"],
    ]));
    const built = buildImportRows(sheets, detectLayout(sheets, "students"), "students");
    expect(built.rows.map((r) => r.reg_no)).toEqual(["RA0000001", "RA0000002"]);
    expect(built.rowNumbers).toEqual([3, 5]);
  });

  it("picks the matching sheet in a multi-sheet workbook", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Instructions").addRow(["Fill in the list on the next sheet"]);
    const data = wb.addWorksheet("Faculty");
    data.addRow(["Employee ID", "Faculty Name", "Mail ID", "Mobile No.", "Cabin", "Designation", "Area of Interest", "Research Areas"]);
    data.addRow([600323, "Dr. Meena", { text: "Meena@SRMIST.edu.in", hyperlink: "mailto:meena@srmist.edu.in" }, 9876543210, "TP 801", "Professor & Head", "AI, Machine Learning\nIoT", "Blockchain"]);
    data.addRow(["600400", "Dr. Arun", "arun@srmist.edu.in", "98765 43211 / 9000000000", "", "Assistant Professor", "", ""]);
    const rows = await parseImportWorkbook(await bytesOf(wb), "faculty");
    expect(rows).toEqual([
      { emp_id: "600323", name: "Dr. Meena", srm_email: "meena@srmist.edu.in", phone: "9876543210", venue: "TP 801", domains: "AI; Machine Learning; IoT; Blockchain", cadre: "HOD" },
      { emp_id: "600400", name: "Dr. Arun", srm_email: "arun@srmist.edu.in", phone: "9876543211", cadre: "OTHER" },
    ]);
    rows.forEach((r) => expect(facultyRowSchema.safeParse(r).success).toBe(true));
  });

  it("defaults cadre to OTHER and never sends designation", async () => {
    const rows = await parseImportWorkbook(await workbook([["Emp ID", "Name", "SRM Email"], ["EMP1001", "X", "x@srmist.edu.in"]]), "faculty");
    expect(rows).toEqual([{ emp_id: "EMP1001", name: "X", srm_email: "x@srmist.edu.in", cadre: "OTHER" }]);
    expect(Object.keys(rows[0])).not.toContain("designation");
  });

  it("maps advisors by email when there is no employee ID", async () => {
    const rows = await parseImportWorkbook(await workbook([["Section", "Faculty Advisor Name", "Faculty Advisor Mail"], ["Section A", "Dr. Ravi", "ravi@srmist.edu.in"]]), "advisors");
    expect(rows).toEqual([{ srm_email: "ravi@srmist.edu.in", section: "A" }]);
    expect(advisorRowSchema.safeParse(rows[0]).success).toBe(true);
    expect(advisorRowSchema.safeParse({ section: "A" }).success).toBe(false);
  });

  it("lets the admin fill a missing field for every row", async () => {
    const sheets = await readImportWorkbook(await workbook([["Reg No", "Name", "Section"], ["RA0000001", "A", "A"]]));
    const layout = detectLayout(sheets, "students");
    expect(buildImportRows(sheets, layout, "students").rows[0].dept).toBe("CSE");
    expect(buildImportRows(sheets, layout, "students", { dept: "IT" }).rows[0].dept).toBe("IT");
    const noSection = { ...layout, mapping: { ...layout.mapping, section: [] } };
    expect(buildImportRows(sheets, noSection, "students").missing).toEqual(["Section"]);
  });

  it("classifies the coordinator's faculty sheet (domains + cadre columns)", async () => {
    const bytes = await workbook([
      ["Emp ID", "Name", "SRM Email", "domains", "cadre"],
      ["100001", "A", "a@srmist.edu.in", "Quantum computing, Wireless sensor Networks", "Professor & Asso Chairperson"],
      ["100002", "B", "b@srmist.edu.in", "Image Processing,Neural Networks", "Professor & Head"],
      ["100003", "C", "c@srmist.edu.in", "Artificial Intelligence (AI)& Machine Learning (ML), Internet of Things (IoT) & Networking, Natural Language Processing (NLP), Robotics and Automation", "Professor & Director (Systems)"],
      ["100004", "D", "d@srmist.edu.in", "Artificial Intelligence (AI) & Machine Learning (ML), Edge computing ( Energy efficiency, Sustainable design and manufacturing )", "Associate Professor"],
      ["100005", "E", "e@srmist.edu.in", "Computer Vision, Geospatial Computing,", "Assistant Professor (Sr.G)"],
      ["100006", "F", "f@srmist.edu.in", "Cyber security", "Research Asst Prof"],
    ]);
    const rows = await parseImportWorkbook(bytes, "faculty");
    expect(rows.map((r) => r.cadre)).toEqual(["ASSOC_CHAIR", "HOD", "OTHER", "OTHER", "OTHER", "OTHER"]);
    expect(rows[1].domains).toBe("Image Processing; Neural Networks");
    expect(rows[2].domains).toBe("Artificial Intelligence (AI) & Machine Learning (ML); Internet of Things (IoT) & Networking; Natural Language Processing (NLP); Robotics and Automation");
    expect(rows[3].domains).toBe("Artificial Intelligence (AI) & Machine Learning (ML); Edge computing (Energy efficiency, Sustainable design and manufacturing)");
    expect(rows[4].domains).toBe("Computer Vision; Geospatial Computing");
    rows.forEach((r) => expect(facultyRowSchema.safeParse(r).success).toBe(true));
    expect(facultyRowSchema.parse(rows[3]).domains).toHaveLength(2);
  });

  it("explains when no header row matches", async () => {
    await expect(parseImportWorkbook(await workbook([["foo", "bar"], [1, 2]]), "students")).rejects.toThrow(/column titles/i);
  });
});

describe("Excel imports: header and value normalising", () => {
  it("canonicalises header spellings", () => {
    expect(canon("E-Mail ID")).toBe("email id");
    expect(canon("Register Number")).toBe("reg no");
    expect(canon("Name of the Student")).toBe("name student");
    expect(canon("Employee No.")).toBe("emp no");
  });
  it("derives cadre from cadre or designation text", () => {
    expect(["HOD", "hod", "H.O.D", "Professor & Head", "Head of the Department"].map(normalizeCadre)).toEqual(Array(5).fill("HOD"));
    expect(["ASSOC_CHAIR", "Associate Chair", "Associate Chairperson", "Professor & Asso Chairperson", "Assoc. Chair"].map(normalizeCadre)).toEqual(Array(5).fill("ASSOC_CHAIR"));
    expect(["", "OTHER", "Associate Professor", "Assistant Professor"].map(normalizeCadre)).toEqual(Array(4).fill("OTHER"));
  });
});

describe("Excel imports: safety", () => {
  it("rejects malformed files and excessive rows", async () => {
    await expect(parseImportWorkbook(new TextEncoder().encode("not excel"), "students")).rejects.toThrow();
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`RA${100000 + i}`, "Name", "CSE", "A"]);
    await expect(parseImportWorkbook(await workbook([["Reg No", "Name", "Dept", "Section"], ...rows]), "students")).rejects.toThrow(/5,000/);
  });
  it("strips control characters and caps cell length instead of failing", async () => {
    const rows = await parseImportWorkbook(await workbook([["Reg No", "Name", "Section"], ["RA0000001", "A\u0007B" + "x".repeat(600), "A"]]), "students");
    expect(rows[0].name).not.toMatch(/\u0007/);
    expect(rows[0].name.length).toBeLessThanOrEqual(500);
  });
  it("rejects excessive declared expansion before loading the workbook", async () => {
    const bytes = await workbook([["Reg No"]]);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 61 * 1024 * 1024, true);
        break;
      }
    }
    await expect(parseImportWorkbook(bytes, "students")).rejects.toThrow(/oversized/i);
  });
});
