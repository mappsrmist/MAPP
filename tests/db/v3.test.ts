/**
 * v3 database tests (migrations 0009/0010): persisted application fields, Faculty Advisors, class overview,
 * remove / exempt students, admin overview counts, designation removal.
 * Same throw-away embedded Postgres approach as v2.test.ts (own port so the files can run in parallel).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.MAPP_TEST_PG_PORT_V3 ?? 54340);
let server: EmbeddedPostgres;
let admin: Client;
const dataDir = mkdtempSync(join(tmpdir(), "mapp-pg3-"));

const STUB = `
create schema auth;
create schema extensions;
create extension pgcrypto schema extensions;
create table auth.users (
  id uuid primary key, email text, instance_id uuid, aud text, role text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token text, email_change text,
  email_change_token_new text, recovery_token text
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public, auth to anon, authenticated;
create publication supabase_realtime;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

async function as<T>(userId: string, fn: (q: Client["query"]) => Promise<T>): Promise<T> {
  await admin.query("begin");
  try {
    await admin.query("set local role authenticated");
    await admin.query("select set_config('request.jwt.sub', $1, true)", [userId]);
    const out = await fn(admin.query.bind(admin) as Client["query"]);
    await admin.query("commit");
    return out;
  } catch (e) {
    await admin.query("rollback");
    throw e;
  }
}

let n = 0;
async function mkProfile(role: string) {
  const id = randomUUID();
  const k = ++n;
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, `v${k}@x.test`]);
  await admin.query("insert into public.profiles (id, role, username, must_change_password) values ($1,$2,$3,false)", [id, role, `v2user${k}`]);
  return { id, k };
}
async function mkStudent(section: string | null = "A") {
  const { id, k } = await mkProfile("student");
  await admin.query(
    "insert into public.students (id, reg_no, name, dept, section, email) values ($1,$2,$3,'CSE',$4,$5)",
    [id, `RB${1000 + k}`, `Student ${k}`, section, `s${k}@srmist.edu.in`],
  );
  return id;
}
async function mkFaculty(cadre: "HOD" | "ASSOC_CHAIR" | "OTHER" = "OTHER", domains: string[] = ["AI"]) {
  const { id, k } = await mkProfile("faculty");
  await admin.query(
    "insert into public.faculty (id, emp_id, name, srm_email, cadre, phone, venue, domains) values ($1,$2,$3,$4,$5,'9999999999','Room 1',$6)",
    [id, `V${k}`, `Guide ${k}`, `g${k}@srmist.edu.in`, cadre, domains],
  );
  return id;
}
const mkAdmin = async () => (await mkProfile("admin")).id;

const request = (s: string, f: string) => as(s, async (q) => (await q("select public.submit_request($1) as id", [f])).rows[0].id as string);
const respond = (f: string, rid: string, status: string) => as(f, (q) => q("select public.respond_request($1,$2)", [rid, status]));
const accepted = async (f: string) => {
  const s = await mkStudent();
  await respond(f, await request(s, f), "accepted");
  return s;
};
const members = (s1: string, s2: string, over: Record<string, string> = {}) =>
  JSON.stringify(
    [s1, s2].map((student_id, i) => ({
      student_id,
      section: i === 0 ? "A" : "B",
      advisor_name: `Dr Advisor ${i + 1}`,
      contact_number: `98765432${10 + i}`,
      srm_mail: `adv${i + 1}@srmist.edu.in`,
      ...over,
    })),
  );
const group = (f: string, no: number, s1: string, s2: string, over: Record<string, string> = {}) =>
  as(f, async (q) => (await q("select public.save_batch($1, $2::jsonb) as id", [no, members(s1, s2, over)])).rows[0].id as string);
const setGlobalFreeze = async (on: boolean) => {
  const a = await mkAdmin();
  await as(a, (q) => q("select public.admin_set_global_freeze($1)", [on]));
};

const APP = [
  "Smart Campus", "1. No Poverty", true, "me@srmist.edu.in", "9876543210",
  "Partner Name", "", "B", "partner@srmist.edu.in", "9123456780",
] as const;
let regSeq = 0;
const saveApp = (s: string, over: Partial<Record<number, unknown>> = {}, submit = false) => {
  const args: unknown[] = [...APP];
  args[6] = `RC${String(++regSeq).padStart(7, "0")}`; // unique per call: a reg no may appear in one application only
  Object.entries(over).forEach(([i, v]) => (args[Number(i)] = v));
  return as(s, async (q) =>
    (await q("select public.save_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id", [...args, submit])).rows[0].id as string,
  );
};
const getApp = (s: string) => as(s, async (q) => (await q("select * from public.get_application()")).rows[0]);

beforeAll(async () => {
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  await server.createDatabase("mapp");
  admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database: "mapp" });
  await admin.connect();
  await admin.query(STUB);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(join(dir, f), "utf8"));
  }
}, 120_000);

afterAll(async () => {
  await admin?.end();
  try {
    await server?.stop(); // also deletes the data dir, which Windows can briefly keep locked
  } catch {
    // best effort: the folder is in the OS temp dir
  }
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Windows may still hold the folder briefly after Postgres stops; it lives in the OS temp dir
  }
}, 60_000);


let secSeq = 0;
const newSection = () => `T${++secSeq}${Math.floor(Math.random() * 1000)}`;
const empOf = async (f: string) => (await admin.query("select emp_id from public.faculty where id=$1", [f])).rows[0].emp_id as string;
let adminId: string;
const setFa = (empId: string, section: string, replace = false) =>
  as(adminId, async (q) => (await q("select public.admin_set_fa($1,$2,$3) as r", [empId, section, replace])).rows[0].r as string);
const overview = (who: string, section: string, status: string | null = null, page = 1) =>
  as(who, async (q) => (await q("select * from public.fa_class_overview($1,null,$2,$3)", [section, status, page])).rows);
const counts = (who: string, section: string) => as(who, async (q) => (await q("select public.fa_class_counts($1) as c", [section])).rows[0].c);
const choiceOf = async (s: string) => (await admin.query("select choice from public.students where id=$1", [s])).rows[0].choice as string | null;
const nameOf = async (f: string) => (await admin.query("select name from public.faculty where id=$1", [f])).rows[0].name as string;

describe("v3 setup", () => {
  it("creates an admin", async () => {
    adminId = await mkAdmin();
    expect(adminId).toBeTruthy();
  });
});

describe("A: application title and mobile numbers persist and reach the guide", () => {
  it("round-trips every field and exposes title + each student's own mobile to the guide", async () => {
    const f = await mkFaculty();
    const s1 = await accepted(f);
    const s2 = await accepted(f);
    await group(f, 1, s1, s2);
    const blank = (await admin.query("select project_title, student_mobile from public.request_details_v where student_id=$1 and faculty_id=$2", [s1, f])).rows[0];
    expect(blank).toEqual({ project_title: null, student_mobile: null }); // not filled yet: blank, not an error

    await saveApp(s1, { 0: "Smart Campus v3", 1: "7. Affordable and Clean Energy", 2: false, 4: "9876543210", 9: "9123456780" });
    const row = (await admin.query("select * from public.applications where student1_id=$1", [s1])).rows[0];
    expect(row).toMatchObject({
      project_title: "Smart Campus v3", sdg_goal: "7. Affordable and Clean Energy", problem_by_guide: false,
      student1_mobile: "9876543210", student2_mobile: "9123456780", status: "draft",
    });
    const reload = await getApp(s2);
    expect(reload).toMatchObject({ project_title: "Smart Campus v3", s1_mobile: "9876543210", s2_mobile: "9123456780", problem_by_guide: false });

    const seen = await as(f, async (q) => (await q("select student_id, project_title, student_mobile from public.request_details_v where status='accepted'")).rows);
    expect(seen.map((r) => [r.student_id, r.project_title, r.student_mobile]).sort()).toEqual(
      [[s1, "Smart Campus v3", "9876543210"], [s2, "Smart Campus v3", "9123456780"]].sort(),
    );
    const apps = await as(f, async (q) => (await q("select project_title from public.applications")).rows);
    expect(apps).toHaveLength(1); // a faculty member reads only their own teams' applications
  });
});

describe("B: Faculty Advisor access", () => {
  it("hides the advisor feature from non-advisors and denies the RPCs server-side", async () => {
    const plain = await mkFaculty();
    const sec = newSection();
    await mkStudent(sec);
    expect((await as(plain, (q) => q("select public.is_faculty_advisor() as v"))).rows[0].v).toBe(false);
    expect((await as(plain, (q) => q("select * from public.my_fa_sections()"))).rows).toHaveLength(0);
    await expect(overview(plain, sec)).rejects.toThrow(/not the Faculty Advisor/i);
    await expect(counts(plain, sec)).rejects.toThrow(/not the Faculty Advisor/i);
    const st = await mkStudent(sec);
    await expect(overview(st, sec)).rejects.toThrow(/not allowed/i);
    await expect(as(plain, (q) => q("insert into public.faculty_advisors (faculty_id, section) values (auth.uid(), 'ZZ')"))).rejects.toThrow(/permission denied/i);
    await expect(as(plain, (q) => q("select public.admin_set_fa('x','y')"))).rejects.toThrow(/not allowed/i);
  });

  it("shows an advisor only their own sections, and the admin sees identical data", async () => {
    const fa = await mkFaculty();
    const other = await mkFaculty();
    const s1 = newSection();
    const s2 = newSection();
    const s3 = newSection();
    const a = await mkStudent(s1);
    await mkStudent(s1);
    await mkStudent(s2);
    await mkStudent(s3);
    expect(await setFa(await empOf(fa), s1)).toBe("added");
    expect(await setFa(await empOf(fa), s2.toLowerCase())).toBe("added"); // normalised: trim + upper case
    expect(await setFa(await empOf(other), s3)).toBe("added");

    const mySections = (await as(fa, (q) => q("select * from public.my_fa_sections()"))).rows.map((r) => r.my_fa_sections);
    expect(mySections).toEqual([s1, s2].sort());
    const mine = await overview(fa, s1);
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.section === s1)).toBe(true);
    await expect(overview(fa, s3)).rejects.toThrow(/not the Faculty Advisor/i); // another advisor's section
    expect(mine.map((r) => r.reg_no)).toEqual((await overview(adminId, s1)).map((r) => r.reg_no));
    expect(await counts(fa, s1)).toEqual(await counts(adminId, s1));
    expect((await counts(adminId, s1)).total).toBe(2);
    // the admin may also inspect a section that has no advisor
    const orphan = newSection();
    await mkStudent(orphan);
    expect((await counts(adminId, orphan)).fa_name).toBeNull();
    // the student's advisor name resolves in the admin tables
    const lst = await as(adminId, async (q) => (await q("select * from public.admin_list_students('not_opted', null, 0)")).rows);
    expect(lst.find((r) => r.id === a)?.fa_name).toBe(await nameOf(fa));
    expect(lst.find((r) => r.section === orphan)?.fa_name).toBeNull();
  });

  it("reports status with precedence Exempt > MOOC > Minor > Not opted, request status and project title", async () => {
    const f = await mkFaculty();
    const sec = newSection();
    const exempt = await mkStudent(sec);
    const mooc = await mkStudent(sec);
    const pending = await mkStudent(sec);
    const grouped1 = await mkStudent(sec);
    const grouped2 = await mkStudent(sec);
    const none = await mkStudent(sec);
    const fa = await mkFaculty();
    await setFa(await empOf(fa), sec);
    await as(adminId, (q) => q("select public.admin_set_exempt($1,true,'sports')", [[exempt]]));
    await as(mooc, (q) => q("select public.opt_mooc(9.5)"));
    await request(pending, f);
    for (const s of [grouped1, grouped2]) await respond(f, await request(s, f), "accepted");
    await group(f, 1, grouped1, grouped2);
    await saveApp(grouped1);

    const rows = await overview(fa, sec);
    const by = Object.fromEntries(rows.map((r) => [r.student_id, r]));
    expect(by[exempt].status).toBe("exempt");
    expect(by[mooc].status).toBe("mooc");
    expect(by[none].status).toBe("not_opted");
    expect(by[pending]).toMatchObject({ status: "minor", request_status: "pending" });
    expect(by[grouped1]).toMatchObject({ status: "minor", request_status: "grouped", project_title: "Smart Campus" });
    expect(by[grouped1].guide_name).toBe(await nameOf(f));
    expect(await counts(fa, sec)).toMatchObject({ total: 6, minor: 3, mooc: 1, not_opted: 1, exempt: 1 });
    expect((await overview(fa, sec, "minor")).map((r) => r.student_id).sort()).toEqual([pending, grouped1, grouped2].sort());
    expect(await overview(fa, sec, "exempt")).toHaveLength(1);
    await expect(overview(fa, sec, "bogus")).rejects.toThrow(/Invalid status/);
    expect((await overview(fa, sec, null, 0)).length).toBe(6); // page 0 = everything (Excel export)
  });

  it("paginates 10 per page and searches by reg no or name", async () => {
    const fa = await mkFaculty();
    const sec = newSection();
    for (let i = 0; i < 12; i++) await mkStudent(sec);
    await setFa(await empOf(fa), sec);
    expect(await overview(fa, sec, null, 1)).toHaveLength(10);
    const p2 = await overview(fa, sec, null, 2);
    expect(p2).toHaveLength(2);
    expect(Number(p2[0].total_count)).toBe(12);
    const hit = await as(fa, async (q) => (await q("select * from public.fa_class_overview($1,'student',null,1)", [sec])).rows);
    expect(hit.length).toBeGreaterThan(0);
  });
});

describe("C5: Faculty Advisor assignment rules", () => {
  it("rejects unknown employee IDs and sections, handles duplicates, replace and idempotency", async () => {
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    const sec = newSection();
    await mkStudent(sec);
    await expect(setFa("NOPE-000", sec)).rejects.toThrow(/Unknown employee ID/);
    await expect(setFa(await empOf(f1), "NO-SUCH-SECTION")).rejects.toThrow(/Unknown section/);
    expect(await setFa(await empOf(f1), `  ${sec.toLowerCase()} `)).toBe("added");
    expect(await setFa((await empOf(f1)).toLowerCase(), sec)).toBe("unchanged"); // idempotent, case-insensitive
    await expect(setFa(await empOf(f2), sec)).rejects.toThrow(/already assigned to/);
    expect(await setFa(await empOf(f2), sec, true)).toBe("replaced");
    const list = await as(adminId, async (q) => (await q("select * from public.admin_list_advisors($1,1)", [sec])).rows);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ section: sec, fa_emp_id: await empOf(f2) });
    expect(Number(list[0].student_count)).toBe(1);
    await as(adminId, (q) => q("select public.admin_remove_fa($1)", [sec]));
    await expect(as(adminId, (q) => q("select public.admin_remove_fa($1)", [sec]))).rejects.toThrow(/no Faculty Advisor/);
    expect((await admin.query("select count(*)::int c from public.audit_log where action in ('set_advisor','remove_advisor')")).rows[0].c).toBeGreaterThanOrEqual(3);
  });

  it("enforces one advisor per section in the database, while one advisor may own several sections", async () => {
    const f = await mkFaculty();
    const a = newSection();
    const b = newSection();
    await mkStudent(a);
    await mkStudent(b);
    await setFa(await empOf(f), a);
    await setFa(await empOf(f), b);
    await expect(admin.query("insert into public.faculty_advisors (faculty_id, section) values ($1, lower($2))", [f, a])).rejects.toThrow(/unique|duplicate/i);
  });

  it("fills a blank Faculty Advisor Name in Batch Grouping from the section mapping and keeps overrides", async () => {
    const f = await mkFaculty();
    const fa = await mkFaculty();
    const sec = newSection();
    const s1 = await accepted(f);
    const s2 = await accepted(f);
    await admin.query("update public.students set section=$1 where id=any($2)", [sec, [s1, s2]]);
    await setFa(await empOf(fa), sec);
    const body = JSON.stringify([
      { student_id: s1, section: sec, advisor_name: "", contact_number: "9876543210", srm_mail: "a@srmist.edu.in" },
      { student_id: s2, section: sec, advisor_name: "Dr Override", contact_number: "9876543211", srm_mail: "b@srmist.edu.in" },
    ]);
    await as(f, (q) => q("select public.save_batch(1, $1::jsonb)", [body]));
    const rows = (await admin.query("select student_id, advisor_name from public.batch_members where student_id=any($1)", [[s1, s2]])).rows;
    expect(rows.find((r) => r.student_id === s1).advisor_name).toBe(await nameOf(fa));
    expect(rows.find((r) => r.student_id === s2).advisor_name).toBe("Dr Override");
    // the faculty member resolves the advisor name for the batch form through the view
    const v = (await as(f, (q) => q("select fa_name from public.request_details_v where student_id=$1", [s1]))).rows[0];
    expect(v.fa_name).toBe(await nameOf(fa));
    // students cannot look advisor names up
    const peek = await as(await mkStudent(), (q) => q("select public.fa_name_for_section($1) as n", [sec]));
    expect(peek.rows[0].n).toBeNull();
  });
});

describe("C1: admin overview counts", () => {
  it("returns only the counts the overview needs, active students only", async () => {
    const stats = (await as(adminId, (q) => q("select public.admin_stats() as s"))).rows[0].s;
    expect(Object.keys(stats).sort()).toEqual(["exempt", "faculty", "minor", "mooc", "not_opted", "students"]);
    const real = (await admin.query("select count(*)::int c from public.students where is_active")).rows[0].c;
    expect(stats.students).toBe(real);
  });
});

describe("C3: remove and exempt students", () => {
  it("removes: frees the seat, dissolves the team, excludes from counts and lists, blocks RPCs, and restores", async () => {
    const f = await mkFaculty();
    const s1 = await accepted(f);
    const s2 = await accepted(f);
    await group(f, 1, s1, s2);
    const seats = async () => (await admin.query("select accepted_count from public.faculty where id=$1", [f])).rows[0].accepted_count as number;
    expect(await seats()).toBe(2);
    const before = (await as(adminId, (q) => q("select public.admin_stats() as s"))).rows[0].s.students as number;

    const out = await as(adminId, (q) => q("select public.admin_remove_students($1) as n", [[s1]]));
    expect(out.rows[0].n).toBe(1);
    expect(await seats()).toBe(1); // seat freed
    expect((await admin.query("select count(*)::int c from public.requests where student_id=$1", [s1])).rows[0].c).toBe(0);
    expect((await admin.query("select count(*)::int c from public.batches where faculty_id=$1", [f])).rows[0].c).toBe(0); // batch dissolved
    expect((await as(adminId, (q) => q("select public.admin_stats() as s"))).rows[0].s.students).toBe(before - 1);
    const listed = await as(adminId, async (q) => (await q("select * from public.admin_list_students('not_opted', null, 0)")).rows);
    expect(listed.some((r) => r.id === s1)).toBe(false);
    const removed = await as(adminId, async (q) => (await q("select * from public.admin_list_students('removed', null, 1)")).rows);
    expect(removed.some((r) => r.id === s1)).toBe(true);
    expect((await as(f, (q) => q("select * from public.request_details_v where student_id=$1", [s1]))).rows).toHaveLength(0);

    // a removed student can do nothing, even with a still-valid session
    await expect(as(s1, (q) => q("select * from public.list_faculty(null,null,1)"))).rejects.toThrow(/not allowed/i);
    await expect(as(s1, (q) => q("select public.opt_mooc(9.5)"))).rejects.toThrow(/not allowed/i);
    expect((await as(s1, (q) => q("select public.app_role() as r"))).rows[0].r).toBeNull();

    await expect(as(await mkStudent(), (q) => q("select public.admin_remove_students($1)", [[s2]]))).rejects.toThrow(/not allowed/i);
    expect((await as(adminId, (q) => q("select public.admin_restore_students($1) as n", [[s1]]))).rows[0].n).toBe(1);
    expect((await as(s1, (q) => q("select public.app_role() as r"))).rows[0].r).toBe("student");
    expect(await choiceOf(s1)).toBeNull();
    await expect(as(adminId, (q) => q("select public.admin_restore_students($1)", [[s1]]))).rejects.toThrow(/removed/);
    const log = (await admin.query("select action from public.audit_log where action in ('remove_students','restore_students')")).rows;
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["remove_students", "restore_students"]));
  });

  it("works while allocations are frozen", async () => {
    const s = await mkStudent();
    await setGlobalFreeze(true);
    try {
      await expect(as(adminId, (q) => q("select public.admin_remove_students($1)", [[s]]))).resolves.toBeDefined();
      await expect(as(adminId, (q) => q("select public.admin_restore_students($1)", [[s]]))).resolves.toBeDefined();
    } finally {
      await setGlobalFreeze(false);
    }
  });

  it("exempts: leaves Not opted, locks MOOC and Minor, is audited, and can be undone", async () => {
    const f = await mkFaculty();
    const s = await mkStudent();
    await as(adminId, (q) => q("select public.admin_set_exempt($1,true,'Lateral entry')", [[s]]));
    expect(await choiceOf(s)).toBe("exempt");
    const notOpted = await as(adminId, async (q) => (await q("select * from public.admin_list_students('not_opted', null, 0)")).rows);
    expect(notOpted.some((r) => r.id === s)).toBe(false);
    const ex = await as(adminId, async (q) => (await q("select * from public.admin_list_students('exempt', null, 0)")).rows);
    expect(ex.find((r) => r.id === s)?.exempt_reason).toBe("Lateral entry");
    const msg = /exempted from MOOC and Minor Project by the admin/;
    await expect(as(s, (q) => q("select public.opt_mooc(9.5)"))).rejects.toThrow(msg);
    await expect(as(s, (q) => q("select public.submit_request($1)", [f]))).rejects.toThrow(msg);
    await expect(as(s, (q) => q("select * from public.list_faculty(null,null,1)"))).rejects.toThrow(msg);
    await expect(as(s, (q) => q("select * from public.get_faculty($1)", [f]))).rejects.toThrow(msg);
    // only students who have not opted can be exempted, and only the admin may do it or write the column
    const moocer = await mkStudent();
    await as(moocer, (q) => q("select public.opt_mooc(9.5)"));
    await expect(as(adminId, (q) => q("select public.admin_set_exempt($1,true,null)", [[moocer]]))).rejects.toThrow(/not opted/);
    await expect(as(s, (q) => q("select public.admin_set_exempt($1,false,null)", [[s]]))).rejects.toThrow(/not allowed/i);
    await expect(as(s, (q) => q("update public.students set choice=null where id=auth.uid()"))).rejects.toThrow(/permission denied/i);

    await as(adminId, (q) => q("select public.admin_set_exempt($1,false,null)", [[s]]));
    expect(await choiceOf(s)).toBeNull();
    expect((await admin.query("select exempt_reason from public.students where id=$1", [s])).rows[0].exempt_reason).toBeNull();
    await expect(as(s, (q) => q("select public.opt_mooc(9.5)"))).resolves.toBeDefined();
    expect((await admin.query("select count(*)::int c from public.audit_log where action in ('exempt','undo_exempt')")).rows[0].c).toBeGreaterThanOrEqual(2);
  });
});

describe("D: no designation anywhere", () => {
  it("drops the column and no function returns it", async () => {
    expect((await admin.query("select 1 from information_schema.columns where table_schema='public' and column_name ilike '%designation%'")).rows).toHaveLength(0);
    expect((await admin.query("select proname from pg_proc where pronamespace='public'::regnamespace and exists (select 1 from unnest(proargnames) a where a ilike '%designation%')")).rows).toHaveLength(0);
    const f = await mkFaculty("HOD");
    expect((await admin.query("select cadre, total_seats from public.faculty where id=$1", [f])).rows[0]).toEqual({ cadre: "HOD", total_seats: 6 }); // cadre still drives seats
    const s = await mkStudent();
    const rows = (await as(s, (q) => q("select * from public.list_faculty(null,null,1)"))).rows;
    rows.forEach((r) => expect(Object.keys(r)).not.toContain("designation"));
  });
});
