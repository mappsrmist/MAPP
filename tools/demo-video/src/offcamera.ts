/** Actions another user performs during a recording (not on screen), through the same RPCs the faculty UI calls. */
import { ADVISOR, DEMO_PASSWORD, SECTION, type DemoFaculty, type DemoStudent } from "./demo-data";
import { adminClient, must, signInAs } from "./supabase";

async function studentId(regNo: string): Promise<string> {
  const row = await must("student lookup", adminClient().from("students").select("id").eq("reg_no", regNo).single());
  return (row as { id: string }).id;
}

/** The advisor approves the student's pending MOOC request. */
export async function approveMooc(student: DemoStudent, advisorPassword = DEMO_PASSWORD) {
  const c = await signInAs(ADVISOR.srm_email, advisorPassword);
  const rows = (await must("fa_mooc_requests", c.rpc("fa_mooc_requests", { p_section: SECTION, p_search: student.reg_no, p_page: 1 }))) as {
    request_id: string;
    status: string;
  }[];
  const pending = rows.find((r) => r.status === "pending");
  if (!pending) throw new Error(`No pending MOOC request for ${student.reg_no}`);
  await must("respond_mooc_request", c.rpc("respond_mooc_request", { p_request: pending.request_id, p_decision: "approved" }));
}

/** The guide accepts both students' requests and groups them as batch `batchNo`. */
export async function acceptAndGroup(guide: DemoFaculty, pair: [DemoStudent, DemoStudent], batchNo = 1) {
  const c = await signInAs(guide.srm_email, DEMO_PASSWORD);
  const ids = await Promise.all(pair.map((s) => studentId(s.reg_no)));
  const { data: reqs, error } = await c.from("requests").select("id, student_id, status").in("student_id", ids).eq("status", "pending");
  if (error) throw new Error(error.message);
  for (const id of ids) {
    const r = reqs?.find((x) => x.student_id === id);
    if (!r) throw new Error(`No pending request from ${id} to ${guide.name}`);
    await must("respond_request", c.rpc("respond_request", { p_request_id: r.id, p_status: "accepted" }));
  }
  await must(
    "save_batch",
    c.rpc("save_batch", {
      p_batch_no: batchNo,
      p_members: pair.map((s, i) => ({ student_id: ids[i], section: SECTION, advisor_name: ADVISOR.name, contact_number: s.mobile, srm_mail: s.email })),
    }),
  );
}
