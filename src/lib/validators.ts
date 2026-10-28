import { z } from "zod";
import { CADRES, type Cadre } from "./config";

const trimmed = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

export const loginSchema = z.object({
  role: z.enum(["student", "faculty", "admin"]),
  username: z.string().trim().min(1, "Username is required").max(200),
  password: z.string().min(1, "Password is required").max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(72, "Use at most 72 characters")
      .regex(/[A-Za-z]/, "Include at least one letter")
      .regex(/[0-9]/, "Include at least one number"),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from the old one",
  });

// ------------------------------------------------------------------ imports
const optional = z
  .string()
  .trim()
  .max(200, "value is too long")
  .optional()
  .transform((v) => (v ? v : null));

export const studentRowSchema = z.object({
  reg_no: trimmed("reg_no", 30)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9]{6,30}$/.test(v), "reg_no must be 6-30 letters/digits with no spaces"),
  name: trimmed("name"),
  dept: trimmed("dept", 100),
  section: trimmed("section", 20),
  email: optional.refine((v) => v === null || z.email().safeParse(v).success, "email is not valid"),
});
export type StudentRow = z.infer<typeof studentRowSchema>;

const cadreSchema = z
  .string({ error: "cadre is required" })
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s-]+/g, "_"))
  .transform((v) => (v === "ASSOCIATE_CHAIR" || v === "ASSOC_CHAIR" ? "ASSOC_CHAIR" : v))
  .refine((v): v is Cadre => (CADRES as readonly string[]).includes(v), "cadre must be HOD, ASSOC_CHAIR or OTHER");

export const facultyRowSchema = z.object({
  // the employee ID is the initial password, so it must meet the minimum password length
  emp_id: trimmed("emp_id", 40).refine((v) => v.length >= 6, "emp_id must be at least 6 characters (it is the initial password)"),
  name: trimmed("name"),
  srm_email: trimmed("srm_email")
    .pipe(z.email("srm_email is not valid"))
    .transform((v) => v.toLowerCase())
    .refine((v) => !v.endsWith("mapp.local"), "srm_email uses a reserved domain"),
  designation: trimmed("designation", 100),
  cadre: cadreSchema,
  phone: optional,
  venue: optional,
  domains: z
    .string()
    .max(500, "domains is too long")
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(";")
        .map((d) => d.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 10),
    ),
});
export type FacultyImportRow = z.infer<typeof facultyRowSchema>;

export const importRequestSchema = z.object({
  type: z.enum(["students", "faculty"]),
  offset: z.number().int().min(0).default(0),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
});

export const resetPasswordSchema = z.object({ profileId: z.uuid() });

// -------------------------------------------------------------------- batch
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{10,13}$/, "Enter a valid phone number (10–13 digits)"));

/** One student's row in a batch: their own section, faculty advisor, contact number and SRM mail. */
const batchMemberSchema = z.object({
  student: z.string().min(1, "Select a student"),
  section: trimmed("Section", 20),
  advisor: trimmed("Faculty advisor name", 100),
  contact: phone,
  mail: z.string().trim().max(200).pipe(z.email("Enter a valid SRM mail ID")),
});

export const batchFormSchema = z
  .object({ m1: batchMemberSchema, m2: batchMemberSchema })
  .refine((v) => v.m1.student !== v.m2.student, { path: ["m2", "student"], message: "Pick two different students" });
export type BatchForm = z.input<typeof batchFormSchema>;

// -------------------------------------------------------------- application
/** "1. No Poverty": a number from 1 to 17 followed by the goal's name (mirrors save_application). */
export const SDG_PATTERN = /^(1[0-7]|[1-9])(\s*[.):-]\s*|\s+)\S/;

const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[0-9]{10}$/, "Enter a 10-digit mobile number"));

const student = {
  name: trimmed("Name", 100),
  reg: trimmed("Registration number", 30)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9]{6,30}$/.test(v), "Enter a valid registration number"),
  section: trimmed("Section", 20),
  mobile,
};

/** Strict rules used on Submit (Save draft only sends what is filled in; the database re-validates both). */
export const applicationSubmitSchema = z.object({
  title: trimmed("Project title", 200),
  sdg: trimmed("SDG goal", 100).refine((v) => SDG_PATTERN.test(v), "Start with the SDG number (1–17), e.g. 1. No Poverty"),
  problem: z.enum(["yes", "no"], { error: "Select Yes or No" }),
  s1_mail: z.string().trim().max(200).pipe(z.email("Enter a valid SRM mail ID")),
  s1_mobile: student.mobile,
  s2_name: student.name,
  s2_reg: student.reg,
  s2_section: student.section,
  s2_mail: z
    .string()
    .trim()
    .max(200)
    .pipe(z.email("Enter a valid SRM mail ID"))
    .refine((v) => /@([a-z0-9-]+\.)*srmist\.edu\.in$/i.test(v), "Use your srmist.edu.in mail ID"),
  s2_mobile: student.mobile,
});
export type ApplicationSubmit = z.input<typeof applicationSubmitSchema>;
