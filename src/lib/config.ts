/** App-wide constants. Rules text and popup messages are meant to be edited here. */

export const PAGE_SIZE = 10;

export const ADMIN_USERNAME = "mappCtech";
export const ADMIN_EMAIL = "admin@mapp.local";
export const STUDENT_EMAIL_DOMAIN = "students.mapp.local";

export const CADRES = ["HOD", "ASSOC_CHAIR", "OTHER"] as const;
export type Cadre = (typeof CADRES)[number];

export const CADRE_LABEL: Record<Cadre, string> = {
  HOD: "HOD",
  ASSOC_CHAIR: "Associate Chair",
  OTHER: "Faculty",
};

/** Mirrors public.cadre_seats() in the database (the DB is the source of truth). */
export const CADRE_SEATS: Record<Cadre, number> = { HOD: 6, ASSOC_CHAIR: 4, OTHER: 8 };
export const seatsForCadre = (c: Cadre) => CADRE_SEATS[c];
export const batchesForCadre = (c: Cadre) => CADRE_SEATS[c] / 2;

/** Column headers of the faculty "Students Approached" table (Section replaced Dept). */
export const APPROACHED_HEADERS = ["Reg No", "Name", "Section", "Status", "Accept", "Decline"] as const;

/** Explicit faculty columns for client queries. */
export const FACULTY_COLS =
  "id, emp_id, name, srm_email, cadre, phone, venue, domains, total_seats, accepted_count, available_seats, frozen";

export const MOOC_TITLE = "Rules and Regulations for MOOC Course Selection – 21CSP303T";

export const MOOC_RULES: { title: string; text: string }[] = [
  { title: "Approved Course Selection", text: "Students must select a MOOC course strictly from the official approved list provided by the MOOC coordinators." },
  { title: "SWAYAM Course List", text: "Students approved for MOOC must choose one course from the official list for the current semester provided by the MOOC coordinators." },
  { title: "Course Relevance", text: "Students should choose a course that complements their existing knowledge and enhances their skills." },
  { title: "Course Duration", text: "Each course must be completed within the prescribed duration of 12 weeks." },
  { title: "Credits", text: "The MOOC course carries a weightage of 3 academic credits." },
  { title: "Weekly Progress Monitoring", text: "Faculty will monitor students' attendance and progress weekly based on assessment completion." },
  { title: "Assessments and Assignments", text: "Students must engage consistently with the course content and complete all assessments and assignments within the specified deadlines." },
  { title: "Certification Submission", text: "After successfully completing the course, students must submit the certificate. The marks obtained will be recorded directly in the Academia portal." },
  { title: "No Repetition of Completed Courses", text: "Students must not select a course already completed as a Professional Elective or Open Elective in the 4th, 5th, or 6th semester." },
  { title: "No Future Elective Overlap", text: "Students must not select a course that they are scheduled to take as a Professional Elective or Open Elective in an upcoming semester." },
  { title: "Failure to Complete the Course", text: "Students who fail the course must complete it in the subsequent semester to earn the required credits." },
  { title: "Faculty Guidance", text: "Students should consult the faculty coordinator or academic advisor if they have any doubts regarding course selection or suitability." },
  { title: "Mandatory Compliance", text: "Students must follow all the prescribed guidelines. Non-compliance may require them to retake the course to earn the required credits." },
  { title: "CGPA Eligibility", text: "Students must have a CGPA of 9.00 or above (up to 10.00) to apply for MOOC. Faculty Advisor approval is required." },
];

export const MOOC_IMPORTANT =
  "Students should wait for the official SWAYAM course list and select only one eligible course from the list approved by the MOOC coordinators.";

/** Exact pop-up / message texts required by the spec. */
export const MSG = {
  FORCE_PASSWORD:
    "For your security, you must change your password before proceeding. Please create a new, strong password to continue using the portal.",
  MOOC_AGREE: "I agree to the rules and regulations and request Faculty Advisor approval for the MOOC course.",
  MOOC_SUCCESS: "Your MOOC request has been sent to your Faculty Advisor. Access will be granted only after approval.",
  MINOR_LOCKED: "You have a pending or approved MOOC request. The Minor Project dashboard is unavailable.",
  EXEMPT: "You are exempted from MOOC and Minor Project by the admin.",
  MEET_FACULTY: "You can call / meet the faculty in person at their venue for approval.",
  APPLICATION_LOCKED: "The Application Form opens only after your guide completes your batch.",
  FROZEN: "Allocations are frozen by the admin",
  FROZEN_HINT: "Requests, responses, batches and applications cannot be changed. You can still view and download everything.",
  FROZEN_FACULTY: "Your allocations are frozen by the admin",
  FROZEN_TIP: "Allocations are frozen by the admin",
} as const;

/** The 17 official UN Sustainable Development Goals (suggestions for the application form). */
export const SDG_GOALS = [
  "1. No Poverty",
  "2. Zero Hunger",
  "3. Good Health and Well-being",
  "4. Quality Education",
  "5. Gender Equality",
  "6. Clean Water and Sanitation",
  "7. Affordable and Clean Energy",
  "8. Decent Work and Economic Growth",
  "9. Industry, Innovation and Infrastructure",
  "10. Reduced Inequalities",
  "11. Sustainable Cities and Communities",
  "12. Responsible Consumption and Production",
  "13. Climate Action",
  "14. Life Below Water",
  "15. Life on Land",
  "16. Peace, Justice and Strong Institutions",
  "17. Partnerships for the Goals",
] as const;

export const PORTAL_HOME = {
  student: "/student/mooc",
  faculty: "/faculty/approached",
  admin: "/admin",
} as const;
export type Role = keyof typeof PORTAL_HOME;
