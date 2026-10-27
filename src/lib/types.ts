import type { Cadre } from "./config";

export type RequestStatus = "pending" | "accepted" | "declined";

export interface FacultyListRow {
  id: string;
  emp_id: string;
  name: string;
  designation: string;
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
  student_id: string;
  reg_no: string;
  student_name: string;
  dept: string;
  student_section: string | null;
  student_email: string | null;
  batch_no: number | null;
  slot: number | null;
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

export interface BatchRow {
  id: string;
  batch_no: number;
  section: string;
  advisor_name: string;
  contact_number: string;
  srm_mail: string;
  batch_members: { slot: number; student_id: string }[];
}
