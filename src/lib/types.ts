import type { Cadre } from "./config";

export type RequestStatus = "pending" | "accepted" | "declined";

export interface FacultyListRow {
  id: string;
  emp_id: string;
  name: string;
  designation: string;
  domains: string[];
  total_seats: number;
  available_seats: number;
  total_count: number;
}

export interface FacultyDetail {
  id: string;
  emp_id: string;
  name: string;
  designation: string;
  phone: string | null;
  venue: string | null;
  domains: string[];
  available_seats: number;
  total_seats: number;
}

export interface MinorStatus {
  request_id: string;
  status: RequestStatus;
  faculty_id: string;
  faculty_emp_id: string;
  faculty_name: string;
  designation: string;
  phone: string | null;
  venue: string | null;
  domains: string[];
  total_seats: number;
  available_seats: number;
  requested_at: string;
  responded_at: string | null;
}

export interface RequestDetail {
  id: string;
  status: RequestStatus;
  project_type: string;
  created_at: string;
  responded_at: string | null;
  faculty_id: string;
  faculty_emp_id: string;
  faculty_name: string;
  faculty_cadre: Cadre;
  faculty_frozen: boolean;
  student_id: string;
  reg_no: string;
  student_name: string;
  dept: string;
  student_section: string | null;
  student_email: string | null;
  batch_id: string | null;
  batch_no: number | null;
  slot: number | null;
  member_section: string | null;
  advisor_name: string | null;
  contact_number: string | null;
  srm_mail: string | null;
  /** the student's batch section, falling back to their own section */
  section: string | null;
  display_status: RequestStatus | "grouped";
}

export interface FacultyRow {
  id: string;
  emp_id: string;
  name: string;
  srm_email: string;
  designation: string;
  cadre: Cadre;
  phone: string | null;
  venue: string | null;
  domains: string[];
  total_seats: number;
  accepted_count: number;
  available_seats: number;
  frozen: boolean;
}

export interface StudentRow {
  id: string;
  reg_no: string;
  name: string;
  dept: string;
  section: string | null;
  email: string | null;
  choice: "mooc" | "minor" | null;
}

export interface BatchMemberRow {
  slot: number;
  student_id: string;
  section: string;
  advisor_name: string;
  contact_number: string;
  srm_mail: string;
}

export interface BatchRow {
  id: string;
  batch_no: number;
  batch_members: BatchMemberRow[];
}

export interface ApplicationForm {
  application_id: string | null;
  status: "draft" | "submitted";
  faculty_id: string;
  project_title: string | null;
  sdg_goal: string | null;
  problem_by_guide: boolean | null;
  s1_name: string;
  s1_reg: string;
  s1_section: string | null;
  s1_mail: string | null;
  s1_mobile: string | null;
  s2_name: string | null;
  s2_reg: string | null;
  s2_section: string | null;
  s2_mail: string | null;
  s2_mobile: string | null;
  /** true when Student 2 is the faculty-formed batch partner (identity fields are read-only) */
  s2_locked: boolean;
  guide_name: string;
  guide_emp_id: string;
  guide_phone: string | null;
  can_edit: boolean;
}

export interface AuditEntry {
  id: number;
  actor: string | null;
  action: string;
  scope: string;
  details: Record<string, unknown>;
  created_at: string;
}
