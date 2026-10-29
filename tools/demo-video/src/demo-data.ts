/** Every account the demo creates. Cleanup deletes exactly these usernames and nothing else. */
export const SECTION = "C1";
/** Password for accounts that skip first login, and the new password typed on camera. */
export const DEMO_PASSWORD = "Mapp@Demo2026";
export const DEPT = "Computing Technologies";

export type DemoStudent = { reg_no: string; name: string; email: string; mobile: string };
export type DemoFaculty = { emp_id: string; name: string; srm_email: string; cadre: "OTHER"; phone: string; venue: string; domains: string };

const student = (reg_no: string, name: string, mobile: string): DemoStudent => ({
  reg_no,
  name,
  email: `${name.split(" ")[0].toLowerCase()}.${reg_no.slice(-3)}@srmist.edu.in`,
  mobile,
});

export const ADVISOR: DemoFaculty = {
  emp_id: "EMP90101",
  name: "Dr. Priya Raman",
  srm_email: "priya.raman@srmist.edu.in",
  cadre: "OTHER",
  phone: "9840012345",
  venue: "TP-1204",
  domains: "Machine Learning; Computer Vision; Data Analytics",
};
export const GUIDE2: DemoFaculty = {
  emp_id: "EMP90102",
  name: "Dr. Karthik Subramanian",
  srm_email: "karthik.subramanian@srmist.edu.in",
  cadre: "OTHER",
  phone: "9840067890",
  venue: "TP-1108",
  domains: "Internet of Things; Embedded Systems; Cloud Computing",
};

export const STUDENT_A = student("RA2311003010901", "Arjun Kumar", "9876500901");
export const STUDENT_B = student("RA2311003010902", "Sneha Iyer", "9876500902");
export const PARTNER_B = student("RA2311003010903", "Rahul Menon", "9876500903");
/** First four approach the advisor for a Minor project; the last requests MOOC. */
export const EXTRAS: DemoStudent[] = [
  student("RA2311003010911", "Divya Lakshmi", "9876500911"),
  student("RA2311003010912", "Karan Mehta", "9876500912"),
  student("RA2311003010913", "Nithya Srinivasan", "9876500913"),
  student("RA2311003010914", "Vikram Reddy", "9876500914"),
  student("RA2311003010915", "Ananya Krishnan", "9876500915"),
];
export const EXTRA_MOOC_CGPA = 9.4;

export const ALL_STUDENTS = [STUDENT_A, STUDENT_B, PARTNER_B, ...EXTRAS];
export const ALL_FACULTY = [ADVISOR, GUIDE2];

const USERNAMES = new Set([...ALL_STUDENTS.map((s) => s.reg_no.toLowerCase()), ...ALL_FACULTY.map((f) => f.srm_email)]);
export const isDemoUsername = (u: string) => USERNAMES.has(u.toLowerCase());

export const studentEmail = (regNo: string) => `${regNo.toLowerCase()}@students.mapp.local`;
