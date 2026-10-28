import { describe, expect, it } from "vitest";
import { normalizeRegNo, usernameToEmail } from "@/lib/auth-utils";
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
    expect(usernameToEmail("admin", "admin")).toBeNull();
    expect(usernameToEmail("admin", "admin@mapp.local")).toBeNull();
    expect(usernameToEmail("admin", "someone")).toBeNull();
  });
});

describe("validation", () => {
  it("accepts a student row and uppercases the reg no", () => {
    const r = studentRowSchema.parse({ reg_no: " ra2411003010058", name: "A", dept: "CSE" });
    expect(r.reg_no).toBe("RA2411003010058");
    expect(r.section).toBeNull();
  });
  it("rejects reg numbers that could not be a safe login name", () => {
    expect(studentRowSchema.safeParse({ reg_no: "RA24 110030", name: "A", dept: "CSE" }).success).toBe(false);
    expect(studentRowSchema.safeParse({ reg_no: "a@b.c", name: "A", dept: "CSE" }).success).toBe(false);
  });
  it("accepts a faculty row and normalises cadre/domains", () => {
    const r = facultyRowSchema.parse({
      emp_id: "E1", name: "X", srm_email: "X@SRMIST.EDU.IN", designation: "Prof",
      cadre: "associate chair", domains: "AI; ML ;",
    });
    expect(r.cadre).toBe("ASSOC_CHAIR");
    expect(r.domains).toEqual(["AI", "ML"]);
    expect(r.srm_email).toBe("x@srmist.edu.in");
  });
  it("rejects bad rows", () => {
    expect(facultyRowSchema.safeParse({ emp_id: "E1", name: "X", srm_email: "nope", designation: "P", cadre: "BOSS" }).success).toBe(false);
    const base = { emp_id: "E1", name: "X", designation: "P", cadre: "OTHER" };
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
