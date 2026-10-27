import { describe, expect, it } from "vitest";
import { dobToPassword, normalizeRegNo, parseDob, usernameToEmail } from "@/lib/auth-utils";
import { batchesForCadre, seatsForCadre } from "@/lib/config";
import { buildSheetRows, fillForBatch } from "@/lib/batch-sheet";
import { safeCell } from "@/lib/excel";
import { batchFormSchema, changePasswordSchema, facultyRowSchema, studentRowSchema } from "@/lib/validators";

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
    expect(usernameToEmail("admin", "someone")).toBeNull();
  });
  it("parses DOBs in both formats and derives the DDMMYYYY password", () => {
    expect(parseDob("15031980")).toBe("1980-03-15");
    expect(parseDob("1980-03-15")).toBe("1980-03-15");
    expect(parseDob("31022000")).toBeNull();
    expect(parseDob("hello")).toBeNull();
    expect(dobToPassword("1980-03-15")).toBe("15031980");
  });
});

describe("validation", () => {
  it("accepts a student row and uppercases the reg no", () => {
    const r = studentRowSchema.parse({ reg_no: " ra24110030100 58", name: "A", dept: "CSE" });
    expect(r.reg_no).toBe("RA24110030100 58".toUpperCase());
    expect(r.section).toBeNull();
  });
  it("accepts a faculty row and normalises cadre/domains", () => {
    const r = facultyRowSchema.parse({
      emp_id: "E1", name: "X", srm_email: "X@SRMIST.EDU.IN", dob: "15031980", designation: "Prof",
      cadre: "associate chair", domains: "AI; ML ;",
    });
    expect(r.cadre).toBe("ASSOC_CHAIR");
    expect(r.domains).toEqual(["AI", "ML"]);
    expect(r.srm_email).toBe("x@srmist.edu.in");
    expect(r.dob).toBe("1980-03-15");
  });
  it("rejects bad rows", () => {
    expect(facultyRowSchema.safeParse({ emp_id: "E1", name: "X", srm_email: "nope", dob: "x", designation: "P", cadre: "BOSS" }).success).toBe(false);
  });
  it("password change must differ from the old one and be 8+ chars", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "abcdefgh", newPassword: "abcdefgh" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "abcdefgh", newPassword: "short" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "abcdefgh", newPassword: "abcdefgh1" }).success).toBe(true);
  });
  it("validates the batch form", () => {
    const ok = { student1: "a", student2: "b", section: "A", advisor: "Dr X", contact: "98765 43210", mail: "x@srmist.edu.in" };
    expect(batchFormSchema.parse(ok).contact).toBe("9876543210");
    expect(batchFormSchema.safeParse({ ...ok, student2: "a" }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...ok, contact: "123" }).success).toBe(false);
    expect(batchFormSchema.safeParse({ ...ok, mail: "nope" }).success).toBe(false);
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
  it("builds two rows per batch, ordered, with distinct fills", () => {
    const rows = buildSheetRows(
      [
        { batch_no: 2, section: "B", advisor_name: "Dr Y", contact_number: "1", srm_mail: "y@x", batch_members: [{ slot: 2, student_id: "d" }, { slot: 1, student_id: "c" }] },
        { batch_no: 1, section: "A", advisor_name: "Dr X", contact_number: "2", srm_mail: "x@x", batch_members: [{ slot: 1, student_id: "a" }, { slot: 2, student_id: "b" }] },
      ],
      { a: { name: "A", reg_no: "RA1" }, b: { name: "B", reg_no: "RA2" }, c: { name: "C", reg_no: "RA3" }, d: { name: "D", reg_no: "RA4" } },
    );
    expect(rows.map((r) => r.regNo)).toEqual(["RA1", "RA2", "RA3", "RA4"]);
    expect(rows.map((r) => r.first)).toEqual([true, false, true, false]);
    expect(rows[0].batchLabel).toBe("B1");
    expect(fillForBatch(1)).not.toBe(fillForBatch(2));
  });
  it("excludes incomplete batches with fewer than 2 students", () => {
    const rows = buildSheetRows(
      [
        { batch_no: 1, section: "A", advisor_name: "Dr X", contact_number: "2", srm_mail: "x@x", batch_members: [{ slot: 1, student_id: "a" }] },
      ],
      { a: { name: "A", reg_no: "RA1" } },
    );
    expect(rows).toEqual([]);
  });
});
