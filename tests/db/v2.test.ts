/**
 * v2 database tests (migration 0005): MOOC/Minor lock, multi-domain list, application form gate,
 * ungroup + per-student batch fields, freeze controls, audit log and admin allocation actions.
 * Same throw-away embedded Postgres approach as rpc.test.ts (own port so the files can run in parallel).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.MAPP_TEST_PG_PORT_V2 ?? 54330);
let server: EmbeddedPostgres;
let admin: Client;

describe("atomic security budgets", () => {
  it("marks budget-consuming RPCs volatile for PostgREST write transactions", async () => {
    const { rows } = await admin.query("select proname, provolatile from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[])",
      [["list_faculty", "list_domains", "get_faculty", "my_minor_status", "get_application", "admin_stats"]]);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.provolatile === "v")).toBe(true);
  });
  it("denies direct role escalation and cross-role admin calls", async () => {
    const student = await mkStudent();
    const faculty = await mkFaculty();
    await expect(as(student, (q) => q("update public.profiles set role='admin' where id=auth.uid()"))).rejects.toThrow(/permission denied/i);
    await expect(as(faculty, (q) => q("select public.admin_set_global_freeze(true)"))).rejects.toThrow(/not allowed/i);
  });
  it("treats SQL-shaped search values as data", async () => {
    const student = await mkStudent();
    const results = await as(student, (q) => q("select * from public.list_faculty($1,null,1)", ["'; drop table public.profiles; --"]));
    expect(results.rows).toHaveLength(0);
    expect((await admin.query("select count(*) from public.profiles")).rows).toHaveLength(1);
  });
  it("persists consumption across successful requests and cannot be cleared by users", async () => {
    const key = `budget:${randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      expect((await admin.query("select public.consume_request_budget($1,3,60) as wait", [key])).rows[0].wait).toBe(0);
    }
    expect((await admin.query("select public.consume_request_budget($1,3,60) as wait", [key])).rows[0].wait).toBeGreaterThan(0);
    const student = await mkStudent();
    await expect(as(student, (q) => q("select public.consume_request_budget('x',1000,60)"))).rejects.toThrow(/permission denied/i);
    await expect(as(student, (q) => q("delete from public.request_budgets"))).rejects.toThrow(/permission denied/i);
  });
  it("limits direct RPC calls for each verified user independently", async () => {
    const student = await mkStudent();
    await admin.query("insert into public.request_budgets values ($1,120,clock_timestamp())", [`rpc:${student}`]);
    await expect(as(student, (q) => q("select public.list_domains()"))).rejects.toThrow(/Too many requests/);
    await expect(as(await mkStudent(), (q) => q("select public.list_domains()"))).resolves.toBeDefined();
  });
  it("serializes concurrent budget consumption", async () => {
    const key = `parallel:${randomUUID()}`;
    const peers = await Promise.all(Array.from({ length: 6 }, async () => {
      const peer = new Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database: "mapp" });
      await peer.connect();
      return peer;
    }));
    try {
      const results = await Promise.all(peers.map((peer) => peer.query("select public.consume_request_budget($1,3,60) as wait", [key])));
      expect(results.filter((r) => r.rows[0].wait === 0)).toHaveLength(3);
    } finally { await Promise.all(peers.map((peer) => peer.end())); }
  });
});
const dataDir = mkdtempSync(join(tmpdir(), "mapp-pg2-"));

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
    "insert into public.faculty (id, emp_id, name, srm_email, designation, cadre, phone, venue, domains) values ($1,$2,$3,$4,'Assistant Professor',$5,'9999999999','Room 1',$6)",
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

describe("A1: MOOC <-> Minor lock", () => {
  it("every Minor RPC rejects a MOOC student, including direct calls", async () => {
    const f = await mkFaculty();
    const s = await mkStudent();
    await as(s, (q) => q("select public.opt_mooc()"));
    const msg = /MOOC course\. The Minor Project dashboard is unavailable/;
    await expect(as(s, (q) => q("select * from public.list_faculty(null,null,1)"))).rejects.toThrow(msg);
    await expect(as(s, (q) => q("select * from public.list_domains()"))).rejects.toThrow(msg);
    await expect(as(s, (q) => q("select * from public.get_faculty($1)", [f]))).rejects.toThrow(msg);
    await expect(request(s, f)).rejects.toThrow(msg);
    await expect(getApp(s)).rejects.toThrow(/opens only after your guide accepts/);
  });
  it("a Minor request blocks MOOC", async () => {
    const f = await mkFaculty();
    const s = await mkStudent();
    await request(s, f);
    await expect(as(s, (q) => q("select public.opt_mooc()"))).rejects.toThrow(/active Minor project request/);
  });
});

describe("A2: multi-domain faculty list", () => {
  it("returns all domains + seats and matches the filter on ANY domain, case-insensitively", async () => {
    const dom = `Cloud${n}`;
    const iot = `IoT${n}`;
    const multi = await mkFaculty("OTHER", [dom, iot]);
    const only = await mkFaculty("OTHER", [dom]);
    const viewer = await mkStudent();
    const byCloud = await as(viewer, async (q) => (await q("select * from public.list_faculty(null,$1,1)", [dom.toUpperCase()])).rows);
    const byIot = await as(viewer, async (q) => (await q("select * from public.list_faculty(null,$1,1)", [iot.toLowerCase()])).rows);
    expect(byCloud.map((r) => r.id).sort()).toEqual([multi, only].sort());
    expect(byIot.map((r) => r.id)).toEqual([multi]);
    expect(byIot[0]).toMatchObject({ domains: [dom, iot], total_seats: 8, available_seats: 8 });
    const domains = await as(viewer, async (q) => (await q("select * from public.list_domains()")).rows.map((r) => r.list_domains));
    expect(domains).toEqual(expect.arrayContaining([dom, iot]));
  });
  it("search and pagination work together with the domain filter", async () => {
    const tag = `Zed${n}`;
    for (let i = 0; i < 12; i++) await mkFaculty("OTHER", [tag, "Other"]);
    const viewer = await mkStudent();
    const p1 = await as(viewer, async (q) => (await q("select * from public.list_faculty('guide',$1,1)", [tag])).rows);
    const p2 = await as(viewer, async (q) => (await q("select * from public.list_faculty('guide',$1,2)", [tag])).rows);
    expect(p1).toHaveLength(10);
    expect(p2).toHaveLength(2);
    expect(Number(p1[0].total_count)).toBe(12);
  });
  it("shows the status card data (domains + seats) for the caller's request", async () => {
    const f = await mkFaculty("OTHER", ["A", "B"]);
    const s = await mkStudent();
    await request(s, f);
    const row = await as(s, async (q) => (await q("select * from public.my_minor_status()")).rows[0]);
    expect(row).toMatchObject({ status: "pending", domains: ["A", "B"], total_seats: 8, available_seats: 8, venue: "Room 1" });
  });
});

describe("A4: application form gate", () => {
  const gate = /opens only after your guide accepts/;
  it("is blocked with no request, pending and declined; allowed after accept", async () => {
    const f = await mkFaculty();
    const s = await mkStudent();
    await expect(getApp(s)).rejects.toThrow(gate);
    await expect(saveApp(s)).rejects.toThrow(gate);
    const rid = await request(s, f);
    await expect(getApp(s)).rejects.toThrow(gate);
    await expect(saveApp(s)).rejects.toThrow(gate);
    await respond(f, rid, "declined");
    await expect(saveApp(s)).rejects.toThrow(gate);
    const s2 = await mkStudent();
    await respond(f, await request(s2, f), "accepted");
    const form = await getApp(s2);
    expect(form).toMatchObject({ application_id: null, s1_reg: expect.stringMatching(/^RB/), can_edit: true });
  });
  it("guide fields always come from the accepted faculty and cannot be tampered with", async () => {
    const f = await mkFaculty();
    const other = await mkFaculty();
    const s = await accepted(f);
    await saveApp(s);
    const form = await getApp(s);
    const real = (await admin.query("select name, emp_id, phone from public.faculty where id=$1", [f])).rows[0];
    expect(form).toMatchObject({ guide_name: real.name, guide_emp_id: real.emp_id, guide_phone: real.phone, faculty_id: f });
    expect(other).not.toBe(f);
    // there is no parameter for guide data, and the table cannot be written directly
    await expect(as(s, (q) => q("update public.applications set faculty_id=$1", [other]))).rejects.toThrow(/permission denied/i);
    await expect(as(s, (q) => q("insert into public.applications (faculty_id, student1_id) values ($1,$2)", [other, s]))).rejects.toThrow(/permission denied/i);
  });
  it("validates SDG, mobile, SRM mail and reg no; submit needs everything and then locks edits", async () => {
    const f = await mkFaculty();
    const s = await accepted(f);
    await expect(saveApp(s, { 1: "No Poverty" })).rejects.toThrow(/SDG/);
    await expect(saveApp(s, { 1: "18. Nothing" })).rejects.toThrow(/SDG/);
    await expect(saveApp(s, { 4: "12345" })).rejects.toThrow(/10 digits/);
    await expect(saveApp(s, { 8: "partner@gmail.com" })).rejects.toThrow(/srmist\.edu\.in/);
    await expect(saveApp(s, { 6: "x y" })).rejects.toThrow(/registration number/);
    await expect(saveApp(s, { 0: null }, true)).rejects.toThrow(/every field/);
    const id = await saveApp(s, {}, true);
    expect((await getApp(s)).status).toBe("submitted");
    await expect(saveApp(s, { 0: "Changed" })).rejects.toThrow(/submitted/);
    const a = await mkAdmin();
    await as(a, (q) => q("select public.admin_set_application_status($1,'draft')", [id]));
    await saveApp(s, { 0: "Changed" });
    expect((await getApp(s)).project_title).toBe("Changed");
  });
  it("prefills the batch partner (read-only), shares one application and ignores tampered partner data", async () => {
    const f = await mkFaculty();
    const [a, b] = [await accepted(f), await accepted(f)];
    await group(f, 1, a, b);
    const before = await getApp(a);
    const partner = (await admin.query("select name, reg_no from public.students where id=$1", [b])).rows[0];
    expect(before).toMatchObject({ s2_name: partner.name, s2_reg: partner.reg_no, s2_locked: true });
    const id = await saveApp(a, { 5: "Fake", 6: "RA0000000" });
    const afterB = await getApp(b); // the partner sees (and can edit) the same application
    expect(afterB.application_id).toBe(id);
    expect(afterB.s2_reg).toBe(partner.reg_no);
    expect((await admin.query("select count(*)::int n from public.applications where faculty_id=$1", [f])).rows[0].n).toBe(1);
    await saveApp(b, { 0: "Edited by partner" });
    expect((await getApp(a)).project_title).toBe("Edited by partner");
  });
  it("a student cannot be in two applications and others cannot see a team's application", async () => {
    const f = await mkFaculty();
    const [a, b, c] = [await accepted(f), await accepted(f), await accepted(f)];
    await saveApp(a, { 6: "RA9000001" });
    await expect(saveApp(b, { 6: "RA9000001" })).rejects.toThrow(/already part of another application/);
    const seen = await as(c, async (q) => (await q("select count(*)::int n from public.applications")).rows[0].n);
    expect(seen).toBe(0);
    const guide = await as(f, async (q) => (await q("select count(*)::int n from public.applications")).rows[0].n);
    expect(guide).toBe(1);
    const otherGuide = await mkFaculty();
    expect(await as(otherGuide, async (q) => (await q("select count(*)::int n from public.applications")).rows[0].n)).toBe(0);
  });
  it("losing the accepted guide removes the application and closes the form", async () => {
    const f = await mkFaculty();
    const s = await accepted(f);
    await saveApp(s);
    const rid = (await admin.query("select id from public.requests where student_id=$1", [s])).rows[0].id;
    const a = await mkAdmin();
    await as(a, (q) => q("select public.admin_remove_accepted($1)", [rid]));
    expect((await admin.query("select count(*)::int n from public.applications where student1_id=$1", [s])).rows[0].n).toBe(0);
    await expect(getApp(s)).rejects.toThrow(/opens only after your guide accepts/);
  });
});

describe("B2/B3/B4: group, ungroup, per-student fields", () => {
  const formed = async (f: string) =>
    (await admin.query("select count(*)::int n from (select b.id from public.batches b join public.batch_members m on m.batch_id=b.id where b.faculty_id=$1 group by b.id having count(*)=2) x", [f])).rows[0].n as number;
  const pool = async (f: string) => (await admin.query(
    "select student_id from public.request_details_v where faculty_id=$1 and status='accepted' and batch_id is null", [f])).rows.length as number;

  it("Group lowers Remaining, Ungroup raises it and returns students to the pool; accepted status and seats are untouched", async () => {
    const f = await mkFaculty("OTHER");
    const [a, b] = [await accepted(f), await accepted(f)];
    const total = (await admin.query("select public.cadre_batches('OTHER') t")).rows[0].t as number;
    expect(total - (await formed(f))).toBe(4);
    expect(await pool(f)).toBe(2);
    const bid = await group(f, 1, a, b);
    expect(total - (await formed(f))).toBe(3);
    expect(await pool(f)).toBe(0);
    const seats = (await admin.query("select accepted_count from public.faculty where id=$1", [f])).rows[0].accepted_count;
    await as(f, (q) => q("select public.ungroup_batch($1)", [bid]));
    expect(total - (await formed(f))).toBe(4);
    expect(await pool(f)).toBe(2);
    expect((await admin.query("select accepted_count from public.faculty where id=$1", [f])).rows[0].accepted_count).toBe(seats);
    expect((await admin.query("select count(*)::int n from public.requests where faculty_id=$1 and status='accepted'", [f])).rows[0].n).toBe(2);
    await group(f, 1, a, b); // can be grouped again
  });
  it("only the owning faculty can ungroup", async () => {
    const f = await mkFaculty();
    const other = await mkFaculty();
    const bid = await group(f, 1, await accepted(f), await accepted(f));
    await expect(as(other, (q) => q("select public.ungroup_batch($1)", [bid]))).rejects.toThrow(/Batch not found/);
  });
  it("Edit keeps the batch and can swap members; each student has their own section/advisor/mail/contact", async () => {
    const f = await mkFaculty();
    const [a, b, c] = [await accepted(f), await accepted(f), await accepted(f)];
    const bid = await group(f, 2, a, b);
    expect(await group(f, 2, a, c, { advisor_name: "Dr Same" })).toBe(bid);
    const rows = (await admin.query("select student_id, slot, section, advisor_name, contact_number, srm_mail from public.batch_members where batch_id=$1 order by slot", [bid])).rows;
    expect(rows.map((r) => r.student_id)).toEqual([a, c]);
    await group(f, 2, a, c);
    const per = (await admin.query("select slot, section, advisor_name, contact_number, srm_mail from public.batch_members where batch_id=$1 order by slot", [bid])).rows;
    expect(per).toEqual([
      { slot: 1, section: "A", advisor_name: "Dr Advisor 1", contact_number: "9876543210", srm_mail: "adv1@srmist.edu.in" },
      { slot: 2, section: "B", advisor_name: "Dr Advisor 2", contact_number: "9876543211", srm_mail: "adv2@srmist.edu.in" },
    ]);
    const view = (await admin.query("select reg_no, section, advisor_name, srm_mail, faculty_cadre from public.request_details_v where batch_id=$1 order by slot", [bid])).rows;
    expect(view.map((r) => r.section)).toEqual(["A", "B"]);
    expect(view[1].advisor_name).toBe("Dr Advisor 2");
    expect(view[0].faculty_cadre).toBe("OTHER");
  });
  it("validates each student's entries", async () => {
    const f = await mkFaculty();
    const [a, b] = [await accepted(f), await accepted(f)];
    await expect(group(f, 1, a, b, { contact_number: "123" })).rejects.toThrow(/contact number/);
    await expect(group(f, 1, a, b, { srm_mail: "nope" })).rejects.toThrow(/SRM mail/);
    await expect(group(f, 1, a, b, { section: "" })).rejects.toThrow(/required/);
    await expect(group(f, 1, a, a)).rejects.toThrow(/different students/);
  });
});

describe("C1: freeze", () => {
  it("global freeze blocks every student and faculty write, but reads and admin actions still work", async () => {
    const f = await mkFaculty();
    const [a, b, c] = [await accepted(f), await accepted(f), await mkStudent()];
    const pending = await request(c, f);
    const bid = await group(f, 1, a, b);
    await setGlobalFreeze(true);
    try {
      const frozen = /frozen by the admin/;
      const d = await mkStudent();
      await expect(request(d, f)).rejects.toThrow(frozen);
      await expect(as(d, (q) => q("select public.opt_mooc()"))).rejects.toThrow(frozen);
      await expect(respond(f, pending, "accepted")).rejects.toThrow(frozen);
      await expect(respond(f, pending, "declined")).rejects.toThrow(frozen);
      await expect(group(f, 2, a, b)).rejects.toThrow(frozen);
      await expect(as(f, (q) => q("select public.ungroup_batch($1)", [bid]))).rejects.toThrow(frozen);
      await expect(as(f, (q) => q("select public.clear_batch(1)"))).rejects.toThrow(frozen);
      await expect(saveApp(a)).rejects.toThrow(frozen);
      // reads keep working
      expect((await getApp(a)).can_edit).toBe(false);
      expect(await as(f, async (q) => (await q("select count(*)::int n from public.request_details_v")).rows[0].n)).toBeGreaterThan(0);
      expect(await as(d, async (q) => (await q("select global_frozen from public.system_settings")).rows[0].global_frozen)).toBe(true);
      // admin actions are allowed while frozen
      const adm = await mkAdmin();
      await as(adm, (q) => q("select public.admin_set_section($1,'Z')", [a]));
      const rid = (await admin.query("select id from public.requests where student_id=$1", [b])).rows[0].id;
      await as(adm, (q) => q("select public.admin_remove_accepted($1)", [rid]));
    } finally {
      await setGlobalFreeze(false);
    }
    await respond(f, pending, "accepted"); // unfrozen again
  });
  it("a per-faculty freeze only locks that faculty", async () => {
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    const [s1, s2] = [await mkStudent(), await mkStudent()];
    const r1 = await request(s1, f1);
    const r2 = await request(s2, f2);
    const adm = await mkAdmin();
    await as(adm, (q) => q("select public.admin_set_faculty_freeze($1,true)", [f1]));
    await expect(respond(f1, r1, "accepted")).rejects.toThrow(/frozen by the admin/);
    await respond(f2, r2, "accepted");
    await as(adm, (q) => q("select public.admin_set_faculty_freeze($1,false)", [f1]));
    await respond(f1, r1, "accepted");
  });
  it("only admins can freeze; clients cannot write flags directly; every change is audited", async () => {
    const f = await mkFaculty();
    const s = await mkStudent();
    await expect(as(s, (q) => q("select public.admin_set_global_freeze(true)"))).rejects.toThrow(/not allowed/);
    await expect(as(f, (q) => q("select public.admin_set_faculty_freeze($1,true)", [f]))).rejects.toThrow(/not allowed/);
    await expect(as(f, (q) => q("update public.faculty set frozen=false, accepted_count=0 where id=$1", [f]))).rejects.toThrow(/permission denied/i);
    await expect(as(s, (q) => q("update public.system_settings set global_frozen=true"))).rejects.toThrow(/permission denied/i);
    await expect(as(s, (q) => q("insert into public.audit_log (action, scope) values ('x','y')"))).rejects.toThrow(/permission denied/i);

    const adm = await mkAdmin();
    await as(adm, (q) => q("select public.admin_set_faculty_freeze($1,true)", [f]));
    await as(adm, (q) => q("select public.admin_set_faculty_freeze($1,false)", [f]));
    const log = await as(adm, async (q) => (await q("select actor, action, scope, details from public.audit_log where details->>'faculty_id'=$1 order by id", [f])).rows);
    expect(log.map((r) => r.action)).toEqual(["freeze", "unfreeze"]);
    expect(log[0]).toMatchObject({ actor: adm, scope: "faculty" });
    expect(await as(s, async (q) => (await q("select count(*)::int n from public.audit_log")).rows[0].n)).toBe(0);
  });
});

describe("C2: admin allocation actions", () => {
  it("edits a section, moves a student between faculty within seat limits, and resets status", async () => {
    const [f1, f2] = [await mkFaculty("HOD"), await mkFaculty("OTHER")];
    const adm = await mkAdmin();
    const s = await accepted(f1);
    const rid = (await admin.query("select id from public.requests where student_id=$1", [s])).rows[0].id;

    await as(adm, (q) => q("select public.admin_set_section($1,'C2')", [s]));
    expect((await admin.query("select section from public.students where id=$1", [s])).rows[0].section).toBe("C2");

    await as(adm, (q) => q("select public.admin_move_student($1,$2)", [rid, f2]));
    const counts = (await admin.query("select id, accepted_count from public.faculty where id in ($1,$2)", [f1, f2])).rows;
    expect(Object.fromEntries(counts.map((r) => [r.id, r.accepted_count]))).toEqual({ [f1]: 0, [f2]: 1 });
    expect((await admin.query("select faculty_id, status from public.requests where id=$1", [rid])).rows[0]).toEqual({ faculty_id: f2, status: "accepted" });

    // target faculty full -> refused
    const full = await mkFaculty("ASSOC_CHAIR");
    for (let i = 0; i < 4; i++) await accepted(full);
    await expect(as(adm, (q) => q("select public.admin_move_student($1,$2)", [rid, full]))).rejects.toThrow(/no available seats/);

    await as(adm, (q) => q("select public.admin_reset_request($1)", [rid]));
    expect((await admin.query("select status from public.requests where id=$1", [rid])).rows[0].status).toBe("pending");
    expect((await admin.query("select accepted_count from public.faculty where id=$1", [f2])).rows[0].accepted_count).toBe(0);
    expect((await admin.query("select choice from public.students where id=$1", [s])).rows[0].choice).toBe("minor");

    const audit = (await admin.query("select action from public.audit_log where actor=$1 order by id", [adm])).rows.map((r) => r.action);
    expect(audit).toEqual(["edit_section", "move_student", "reset_request"]);
  });
  it("removing from a faculty frees the seat and unlocks the student; non-admins are refused", async () => {
    const f = await mkFaculty();
    const s = await accepted(f);
    const rid = (await admin.query("select id from public.requests where student_id=$1", [s])).rows[0].id;
    await expect(as(f, (q) => q("select public.admin_remove_accepted($1)", [rid]))).rejects.toThrow(/not allowed/);
    await expect(as(s, (q) => q("select public.admin_move_student($1,$2)", [rid, f]))).rejects.toThrow(/not allowed/);
    const adm = await mkAdmin();
    await as(adm, (q) => q("select public.admin_remove_accepted($1)", [rid]));
    expect((await admin.query("select accepted_count from public.faculty where id=$1", [f])).rows[0].accepted_count).toBe(0);
    expect((await admin.query("select choice from public.students where id=$1", [s])).rows[0].choice).toBeNull();
  });
  it("the allocation view exposes the display status for the admin filters", async () => {
    const f = await mkFaculty();
    const [a, b] = [await accepted(f), await accepted(f)];
    const c = await mkStudent();
    await request(c, f);
    await group(f, 1, a, b);
    const adm = await mkAdmin();
    const rows = await as(adm, async (q) => (await q("select display_status, count(*)::int n from public.request_details_v where faculty_id=$1 group by 1", [f])).rows);
    expect(Object.fromEntries(rows.map((r) => [r.display_status, r.n]))).toEqual({ grouped: 2, pending: 1 });
  });
});
