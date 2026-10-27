/**
 * DEV-ONLY mock backend (NEXT_PUBLIC_MOCK=1). An in-memory stand-in for Supabase so the UI can be
 * tested without a project. It mirrors the SQL RPC rules but has no RLS and resets on server restart.
 * Disabled automatically in production builds. Remove the flag to use the real backend.
 */
import { ADMIN_EMAIL, STUDENT_EMAIL_DOMAIN, CADRE_SEATS, batchesForCadre, type Cadre } from "@/lib/config";

type Row = Record<string, unknown>;
interface Db {
  profiles: Row[];
  students: Row[];
  faculty: Row[];
  requests: Row[];
  batches: Row[];
  batch_members: Row[];
  creds: Map<string, { password: string; id: string }>; // auth email -> credentials
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function seed(): Db {
  const db: Db = { profiles: [], students: [], faculty: [], requests: [], batches: [], batch_members: [], creds: new Map() };

  const adminId = uid();
  db.profiles.push({ id: adminId, role: "admin", username: "mappCtech", must_change_password: false });
  db.creds.set(ADMIN_EMAIL, { password: "mappCtech", id: adminId });

  const names = ["Test Student", "Diya Sharma", "Vivaan Reddy", "Ananya Iyer", "Aditya Menon", "Ishita Nair", "Rohan Das", "Meera Pillai", "Karthik Raj", "Sneha Gupta", "Arjun Verma", "Pooja Singh"];
  names.forEach((name, i) => {
    const reg = `RA24000000000${String(i + 1).padStart(2, "0")}`;
    const id = uid();
    db.profiles.push({ id, role: "student", username: reg, must_change_password: false });
    db.students.push({ id, reg_no: reg, name, dept: i % 2 ? "IT" : "CSE", section: i % 2 ? "B" : "A", email: `${reg.toLowerCase()}@srmist.edu.in`, choice: null, choice_at: null });
    db.creds.set(`${reg.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`, { password: reg, id });
  });

  const domains = [["AI", "Machine Learning"], ["Cyber Security", "Networks"], ["Web Technologies", "Cloud Computing"], ["Data Science"], ["IoT", "Embedded Systems"], ["Computer Vision", "AI"]];
  for (let i = 1; i <= 12; i++) {
    const email = i === 1 ? "test.faculty@srmist.edu.in" : `faculty${String(i).padStart(2, "0")}@srmist.edu.in`;
    const cadre: Cadre = i === 2 ? "HOD" : i === 3 ? "ASSOC_CHAIR" : "OTHER";
    const id = uid();
    db.profiles.push({ id, role: "faculty", username: email, must_change_password: false });
    db.faculty.push({
      id, emp_id: `E${2000 + i}`, name: i === 1 ? "Test Faculty" : `Dr. Faculty ${String(i).padStart(2, "0")}`, srm_email: email, dob: "1980-01-01",
      designation: cadre === "HOD" ? "Professor & Head" : cadre === "ASSOC_CHAIR" ? "Associate Chair" : "Assistant Professor", cadre,
      phone: `98400${String(10000 + i)}`, venue: `TP ${600 + i}`, domains: domains[i % domains.length],
      total_seats: CADRE_SEATS[cadre], accepted_count: 0, available_seats: CADRE_SEATS[cadre],
    });
    db.creds.set(email, { password: email, id });
  }

  // a few pending requests to the test faculty so the faculty screens have content
  const tf = db.faculty[0];
  for (const i of [1, 2, 3]) {
    const s = db.students[i];
    db.requests.push({ id: uid(), student_id: s.id, faculty_id: tf.id, project_type: "minor", status: "pending", created_at: now(), responded_at: null });
    s.choice = "minor";
  }
  db.students[4].choice = "mooc"; // Aditya Menon already chose MOOC
  return db;
}

const g = globalThis as unknown as { __mappMock?: Db };
export const db = (): Db => (g.__mappMock ??= seed());

// ------------------------------------------------------------------ helpers
const find = (t: Row[], id: unknown) => t.find((r) => r.id === id);
const syncSeats = (f: Row) => {
  f.available_seats = (f.total_seats as number) - (f.accepted_count as number);
};
const active = (d: Db, sid: unknown) => d.requests.some((r) => r.student_id === sid && (r.status === "pending" || r.status === "accepted"));
const roleOf = (d: Db, id: string | null) => (d.profiles.find((p) => p.id === id)?.role as string | undefined) ?? null;

class MockError extends Error {}
const fail = (m: string): never => {
  throw new MockError(m);
};
function need(d: Db, id: string | null, role: string) {
  if (!id) fail("You are not signed in.");
  if (roleOf(d, id) !== role) fail("You are not allowed to do this.");
}

/** Row shape of public.request_details_v. */
function details(d: Db): Row[] {
  return d.requests.map((r) => {
    const f = find(d.faculty, r.faculty_id)!;
    const s = find(d.students, r.student_id)!;
    const bm = r.status === "accepted" ? d.batch_members.find((m) => m.student_id === r.student_id) : undefined;
    const b = bm ? find(d.batches, bm.batch_id) : undefined;
    return {
      id: r.id, status: r.status, project_type: r.project_type, created_at: r.created_at, responded_at: r.responded_at,
      faculty_id: f.id, faculty_emp_id: f.emp_id, faculty_name: f.name,
      student_id: s.id, reg_no: s.reg_no, student_name: s.name, dept: s.dept, student_section: s.section, student_email: s.email,
      batch_no: b?.batch_no ?? null, slot: bm?.slot ?? null,
      status_rank: r.status === "pending" ? 0 : r.status === "accepted" ? 1 : 2,
    };
  });
}

// --------------------------------------------------------------------- RPCs
export function rpc(fn: string, a: Record<string, unknown>, me: string | null): unknown {
  const d = db();
  switch (fn) {
    case "opt_mooc": {
      need(d, me, "student");
      const s = find(d.students, me)!;
      if (s.choice === "mooc") fail("You have already opted for the MOOC course.");
      if (s.choice === "minor" || active(d, me)) fail("You have an active Minor project request, so you cannot opt for MOOC.");
      Object.assign(s, { choice: "mooc", choice_at: now() });
      return null;
    }
    case "submit_request": {
      need(d, me, "student");
      const s = find(d.students, me)!;
      if (s.choice === "mooc") fail("You have already opted for the MOOC course. The Minor Project dashboard is unavailable.");
      if (active(d, me)) fail("You already have an active Minor project request.");
      const f = find(d.faculty, a.p_faculty_id);
      if (!f) fail("Faculty not found.");
      if ((f!.available_seats as number) <= 0) fail("This faculty has no available seats.");
      const id = uid();
      d.requests.push({ id, student_id: me, faculty_id: f!.id, project_type: "minor", status: "pending", created_at: now(), responded_at: null });
      Object.assign(s, { choice: "minor", choice_at: now() });
      return id;
    }
    case "list_faculty": {
      need(d, me, "student");
      minorOpen(d, me!);
      const q = String(a.p_search ?? "").trim().toLowerCase();
      const dom = String(a.p_domain ?? "").trim();
      const page = Math.max(Number(a.p_page ?? 1), 1);
      const all = d.faculty
        .filter((f) => (f.available_seats as number) > 0)
        .filter((f) => !q || String(f.name).toLowerCase().includes(q) || String(f.emp_id).toLowerCase().includes(q))
        .filter((f) => !dom || (f.domains as string[]).includes(dom))
        .sort((x, y) => String(x.name).localeCompare(String(y.name)));
      return all.slice((page - 1) * 10, page * 10).map((f) => ({ id: f.id, emp_id: f.emp_id, name: f.name, designation: f.designation, total_count: all.length }));
    }
    case "list_domains": {
      need(d, me, "student");
      return [...new Set(d.faculty.filter((f) => (f.available_seats as number) > 0).flatMap((f) => f.domains as string[]))].sort();
    }
    case "get_faculty": {
      need(d, me, "student");
      minorOpen(d, me!);
      const f = find(d.faculty, a.p_id);
      if (!f || (f.available_seats as number) <= 0) fail("This faculty is no longer available.");
      return [f];
    }
    case "my_minor_status": {
      need(d, me, "student");
      const r = d.requests.filter((x) => x.student_id === me).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
      if (!r) return [];
      const f = find(d.faculty, r.faculty_id)!;
      return [{
        request_id: r.id, status: r.status, faculty_id: f.id, faculty_emp_id: f.emp_id, faculty_name: f.name, designation: f.designation,
        phone: f.phone, venue: f.venue, requested_at: r.created_at, responded_at: r.responded_at,
      }];
    }
    case "respond_request": {
      need(d, me, "faculty");
      const status = String(a.p_status);
      if (status !== "accepted" && status !== "declined") fail("Invalid status.");
      const r = d.requests.find((x) => x.id === a.p_request_id && x.faculty_id === me);
      if (!r) fail("Request not found.");
      if (r!.status !== "pending") fail(`This request has already been ${r!.status}.`);
      const f = find(d.faculty, me)!;
      if (status === "accepted") {
        if ((f.accepted_count as number) >= (f.total_seats as number)) fail("No seats available. You can only decline remaining requests.");
        f.accepted_count = (f.accepted_count as number) + 1;
        syncSeats(f);
      } else {
        const s = find(d.students, r!.student_id)!;
        if (s.choice === "minor") Object.assign(s, { choice: null, choice_at: null });
      }
      Object.assign(r!, { status, responded_at: now() });
      return null;
    }
    case "save_batch": {
      need(d, me, "faculty");
      const f = find(d.faculty, me)!;
      const no = Number(a.p_batch_no);
      const s1 = a.p_student1, s2 = a.p_student2;
      if (!(no >= 1 && no <= batchesForCadre(f.cadre as Cadre))) fail("Invalid batch number for your cadre.");
      if (!s1 || !s2 || s1 === s2) fail("Select two different students.");
      if (!String(a.p_section ?? "").trim() || !String(a.p_advisor ?? "").trim()) fail("Section and Faculty Advisor Name are required.");
      if (!/^\+?[0-9]{10,13}$/.test(String(a.p_contact))) fail("Enter a valid contact number.");
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(a.p_mail))) fail("Enter a valid SRM mail ID.");
      let b = d.batches.find((x) => x.faculty_id === me && x.batch_no === no);
      for (const sid of [s1, s2]) {
        if (!d.requests.some((r) => r.student_id === sid && r.faculty_id === me && r.status === "accepted")) fail("Both students must be accepted by you.");
        if (d.batch_members.some((m) => m.student_id === sid && m.batch_id !== b?.id)) fail("A selected student is already placed in another batch.");
      }
      const fields = { section: String(a.p_section).trim(), advisor_name: String(a.p_advisor).trim(), contact_number: a.p_contact, srm_mail: String(a.p_mail).trim().toLowerCase() };
      if (b) Object.assign(b, fields);
      else d.batches.push((b = { id: uid(), faculty_id: me, project_type: "minor", batch_no: no, ...fields }));
      d.batch_members = d.batch_members.filter((m) => m.batch_id !== b.id);
      d.batch_members.push({ batch_id: b.id, slot: 1, student_id: s1 }, { batch_id: b.id, slot: 2, student_id: s2 });
      return b.id;
    }
    case "clear_batch": {
      need(d, me, "faculty");
      const b = d.batches.find((x) => x.faculty_id === me && x.batch_no === a.p_batch_no);
      if (b) {
        d.batches = d.batches.filter((x) => x !== b);
        d.batch_members = d.batch_members.filter((m) => m.batch_id !== b.id);
      }
      return null;
    }
    case "admin_remove_accepted": {
      need(d, me, "admin");
      const r = find(d.requests, a.p_request_id);
      if (!r) fail("Request not found.");
      if (r!.status !== "accepted") fail("Only accepted requests can be removed.");
      const f = find(d.faculty, r!.faculty_id)!;
      const mem = d.batch_members.find((m) => m.student_id === r!.student_id);
      if (mem) {
        d.batches = d.batches.filter((b) => b.id !== mem.batch_id);
        d.batch_members = d.batch_members.filter((m) => m.batch_id !== mem.batch_id);
      } else {
        d.batch_members = d.batch_members.filter((m) => m.student_id !== r!.student_id);
      }
      f.accepted_count = (f.accepted_count as number) - 1;
      syncSeats(f);
      Object.assign(r!, { status: "declined", responded_at: now() });
      const s = find(d.students, r!.student_id)!;
      if (s.choice === "minor") Object.assign(s, { choice: null, choice_at: null });
      return null;
    }
    case "admin_reset_choice": {
      need(d, me, "admin");
      if (active(d, a.p_student_id)) fail("Student has an active request. Remove it first.");
      Object.assign(find(d.students, a.p_student_id)!, { choice: null, choice_at: null });
      return null;
    }
    case "admin_stats": {
      need(d, me, "admin");
      const n = (s: string) => d.requests.filter((r) => r.status === s).length;
      return {
        students: d.students.length, faculty: d.faculty.length, mooc: d.students.filter((s) => s.choice === "mooc").length,
        pending: n("pending"), accepted: n("accepted"), declined: n("declined"), no_choice: d.students.filter((s) => !s.choice).length,
        total_seats: d.faculty.reduce((t, f) => t + (f.total_seats as number), 0), filled_seats: d.faculty.reduce((t, f) => t + (f.accepted_count as number), 0),
      };
    }
  }
  return fail(`Mock RPC not implemented: ${fn}`);
}

function minorOpen(d: Db, me: string) {
  const s = find(d.students, me)!;
  if (s.choice === "mooc") fail("You have already opted for the MOOC course. The Minor Project dashboard is unavailable.");
  if (active(d, me)) fail("You already have an active Minor project request.");
}

// ------------------------------------------------------------- table queries
export type Op = [string, ...unknown[]];
export interface QueryReq {
  kind: "query";
  table: string;
  ops: Op[];
}
export interface RpcReq {
  kind: "rpc";
  fn: string;
  args: Record<string, unknown>;
}
export interface Result {
  data: unknown;
  count?: number | null;
  error: { message: string } | null;
}

export function execQuery(req: QueryReq): Result {
  const d = db();
  try {
    let rows: Row[] = req.table === "request_details_v" ? details(d) : ((d as unknown as Record<string, Row[]>)[req.table] ?? fail(`Unknown table ${req.table}`)).slice();
    let count: number | null = null;
    let selectCols = "*";
    let wantCount = false;
    let single: "single" | "maybeSingle" | null = null;
    let from = 0, to = Infinity;
    const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];

    for (const [op, ...args] of req.ops) {
      if (op === "select") {
        selectCols = String(args[0] ?? "*");
        wantCount = (args[1] as { count?: string } | undefined)?.count === "exact";
      } else if (op === "eq") rows = rows.filter((r) => r[args[0] as string] === args[1]);
      else if (op === "is") rows = rows.filter((r) => (r[args[0] as string] ?? null) === args[1]);
      else if (op === "or") {
        const clauses = String(args[0]).split(",").map((c) => /^(\w+)\.ilike\.(.*)$/.exec(c.trim())).filter(Boolean) as RegExpExecArray[];
        rows = rows.filter((r) => clauses.some((m) => String(r[m[1]] ?? "").toLowerCase().includes(m[2].replace(/%/g, "").toLowerCase())));
      } else if (op === "order") {
        const o = (args[1] ?? {}) as { ascending?: boolean; nullsFirst?: boolean };
        orders.push({ col: args[0] as string, asc: o.ascending !== false, nullsFirst: !!o.nullsFirst });
      } else if (op === "range") [from, to] = [args[0] as number, args[1] as number];
      else if (op === "limit") to = from + (args[0] as number) - 1;
      else if (op === "single" || op === "maybeSingle") single = op;
    }

    for (let i = orders.length - 1; i >= 0; i--) {
      const { col, asc, nullsFirst } = orders[i];
      rows.sort((x, y) => {
        const a = x[col], b = y[col];
        if (a == null || b == null) return a == null && b == null ? 0 : (a == null) === nullsFirst ? -1 : 1;
        const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
        return asc ? c : -c;
      });
    }
    if (wantCount) count = rows.length;
    rows = rows.slice(from, Number.isFinite(to) ? to + 1 : undefined);
    if (req.table === "batches" && selectCols.includes("batch_members")) {
      rows = rows.map((b) => ({ ...b, batch_members: d.batch_members.filter((m) => m.batch_id === b.id).map((m) => ({ slot: m.slot, student_id: m.student_id })) }));
    }
    if (single) {
      if (rows.length === 1) return { data: rows[0], count, error: null };
      return single === "maybeSingle" && rows.length === 0 ? { data: null, count, error: null } : { data: null, count, error: { message: "Row not found" } };
    }
    return { data: rows, count, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "Mock error" } };
  }
}

export function execRpc(req: RpcReq, me: string | null): Result {
  try {
    return { data: rpc(req.fn, req.args, me), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "Mock error" } };
  }
}
