import { expect, it } from "vitest";
import { buildSheetRows } from "@/lib/batch-sheet";
import { buildBatchWorkbook } from "@/lib/excel";

it("looks up each grouped student's own application mobile", () => {
  const member = (student_id: string, slot: number) => ({ student_id, slot, section: "A", advisor_name: "Advisor", contact_number: "1234567890", srm_mail: "student@example.com" });
  const rows = buildSheetRows([{ batch_no: 1, batch_members: [member("a", 1), member("c", 2)] }], {}, "Guide", {
    applications: [
      { student1_id: "a", student2_id: "b", student1_mobile: "1111111111", student2_mobile: "2222222222", project_title: "AB" },
      { student1_id: "d", student2_id: "c", student1_mobile: "4444444444", student2_mobile: "3333333333", project_title: "CD" },
    ],
  });
  expect(rows.map((row) => row.studentMobile)).toEqual(["1111111111", "3333333333"]);
  expect(rows.map((row) => row.projectTitle)).toEqual(["AB", "CD"]);
});

it("leaves the mobile blank when the grouped student has no application", () => {
  const member = (student_id: string, slot: number) => ({ student_id, slot, section: "A", advisor_name: "Advisor", contact_number: "1234567890", srm_mail: "student@example.com" });
  const rows = buildSheetRows([{ batch_no: 1, batch_members: [member("a", 1), member("c", 2)] }], {}, "Guide", {
    applications: [{ student1_id: "a", student2_id: "b", student1_mobile: "1111111111", student2_mobile: "2222222222", project_title: "AB" }],
  });
  expect(rows[1].studentMobile).toBe("");
  expect(rows[1].projectTitle).toBe("");
});

it.each([false, true])("keeps different project titles separate in Excel (lead employee ID: %s)", async (leadEmpId) => {
  const member = (student_id: string, slot: number) => ({ student_id, slot, section: "A", advisor_name: "Advisor", contact_number: "1234567890", srm_mail: "student@example.com" });
  const rows = buildSheetRows([{ batch_no: 1, batch_members: [member("a", 1), member("b", 2)] }], {}, "Guide");
  rows[0].projectTitle = "Project A";
  rows[1].projectTitle = "=Project B";
  const wb = await buildBatchWorkbook([{ name: "Mixed", title: "Mixed", rows, leadEmpId }]);
  const ws = wb.getWorksheet("Mixed")!;
  const titleColumn = leadEmpId ? 10 : 9;
  expect(ws.getCell(3, titleColumn).value).toBe("Project A");
  expect(ws.getCell(4, titleColumn).value).toBe("'=Project B");
  expect(ws.getCell(4, titleColumn).isMerged).toBe(false);
  expect(ws.getCell(4, leadEmpId ? 2 : 1).isMerged).toBe(true);
});

it.each(["Shared project", ""])("merges matching project titles in Excel (%s)", async (title) => {
  const member = (student_id: string, slot: number) => ({ student_id, slot, section: "A", advisor_name: "Advisor", contact_number: "1234567890", srm_mail: "student@example.com" });
  const rows = buildSheetRows([{ batch_no: 1, batch_members: [member("a", 1), member("b", 2)] }], {}, "Guide");
  rows.forEach((row) => { row.projectTitle = title; });
  const wb = await buildBatchWorkbook([{ name: "Shared", title: "Shared", rows }]);
  expect(wb.getWorksheet("Shared")!.getCell("I4").master.address).toBe("I3");
});
