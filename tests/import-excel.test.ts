import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseImportWorkbook, validateImportFile, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/import-excel";

async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Students");
  rows.forEach((row) => sheet.addRow(row));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const headers = ["reg_no", "name", "dept", "section", "email"];

describe("Excel imports", () => {
  it("only accepts bounded xlsx files", () => {
    expect(() => validateImportFile({ name: "students.xlsx", size: 100 })).not.toThrow();
    expect(() => validateImportFile({ name: "students.csv", size: 100 })).toThrow(/xlsx/i);
    expect(() => validateImportFile({ name: "students.xlsm", size: 100 })).toThrow(/xlsx/i);
    expect(() => validateImportFile({ name: "students.xlsx", size: MAX_IMPORT_BYTES + 1 })).toThrow(/2 MiB/);
  });
  it("reads trimmed text and numbers, skips empty rows and preserves text identifiers", async () => {
    const bytes = await workbook([headers, ["001234", " Student ", "CSE", "A", ""], [], [123456, "Other", "CSE", "B"]]);
    expect(await parseImportWorkbook(bytes, "students")).toEqual([
      { reg_no: "001234", name: "Student", dept: "CSE", section: "A", email: "" },
      { reg_no: "123456", name: "Other", dept: "CSE", section: "B", email: "" },
    ]);
  });
  it("rejects formulas even when a cached result is present", async () => {
    const bytes = await workbook([headers, ["123456", { formula: 'HYPERLINK("https://evil.test","Name")', result: "Name" }, "CSE", "A"]]);
    await expect(parseImportWorkbook(bytes, "students")).rejects.toThrow(/formula|plain text/i);
  });
  it("rejects unexpected and duplicate headers", async () => {
    await expect(parseImportWorkbook(await workbook([[...headers, "role"]]), "students")).rejects.toThrow(/column/i);
    await expect(parseImportWorkbook(await workbook([[...headers, "name"]]), "students")).rejects.toThrow(/column/i);
  });
  it("rejects missing headers and data beyond the header columns", async () => {
    await expect(parseImportWorkbook(await workbook([["name"]]), "students")).rejects.toThrow(/column/i);
    await expect(parseImportWorkbook(await workbook([headers, ["123456", "Name", "CSE", "A", "", "admin"]]), "students")).rejects.toThrow(/column/i);
  });
  it("rejects malformed files and excessive rows", async () => {
    await expect(parseImportWorkbook(new TextEncoder().encode("not excel"), "students")).rejects.toThrow();
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ["123456", "Name", "CSE", "A"]);
    await expect(parseImportWorkbook(await workbook([headers, ...rows]), "students")).rejects.toThrow(/5,000/);
  });
  it("rejects multiple worksheets and hyperlinks", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("One").addRow(headers);
    wb.addWorksheet("Two");
    await expect(parseImportWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()), "students")).rejects.toThrow(/one worksheet/i);
    const bytes = await workbook([headers, ["123456", { text: "Name", hyperlink: "https://evil.test" }, "CSE", "A"]]);
    await expect(parseImportWorkbook(bytes, "students")).rejects.toThrow(/plain text/i);
  });
  it("rejects merged cells before the workbook parser expands them", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Students");
    sheet.addRow(headers);
    sheet.mergeCells("A2:B2");
    await expect(parseImportWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()), "students")).rejects.toThrow(/merged cells/i);
  });
  it("rejects values beyond the supplied header even when optional columns are omitted", async () => {
    await expect(parseImportWorkbook(await workbook([headers.slice(0, 4), ["123456", "Name", "CSE", "A", "hidden"]]), "students")).rejects.toThrow(/beyond the header/i);
  });
  it("rejects excessive declared expansion before loading the workbook", async () => {
    const bytes = await workbook([headers]);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 21 * 1024 * 1024, true);
        break;
      }
    }
    await expect(parseImportWorkbook(bytes, "students")).rejects.toThrow(/oversized/i);
  });
});
