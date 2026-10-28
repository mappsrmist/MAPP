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
  section: optional,
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
  emp_id: trimmed("emp_id", 40),
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
export const batchFormSchema = z.object({
  student1: z.string().min(1, "Select student 1"),
  student2: z.string().min(1, "Select student 2"),
  section: trimmed("Section", 20),
  advisor: trimmed("Faculty advisor name", 100),
  contact: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\+?[0-9]{10,13}$/, "Enter a valid phone number (10–13 digits)")),
  mail: z.string().trim().pipe(z.email("Enter a valid SRM mail ID")),
}).refine((v) => v.student1 !== v.student2, { path: ["student2"], message: "Pick two different students" });
export type BatchForm = z.input<typeof batchFormSchema>;
