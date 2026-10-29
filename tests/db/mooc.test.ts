import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.MAPP_TEST_PG_PORT_MOOC ?? 55444);
let server: EmbeddedPostgres;
let admin: Client;
const dataDir = mkdtempSync(join(tmpdir(), "mapp-mooc-"));

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

let legacyStudent: string;
let legacyFaculty: string;
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
    if (f.startsWith("0012")) {
      legacyFaculty = await mkFaculty();
      legacyStudent = await mkStudent("LEGACY");
      await admin.query("insert into public.faculty_advisors(section,faculty_id) values ('LEGACY',$1)", [legacyFaculty]);
      await admin.query("update public.students set choice='mooc',choice_at=now() where id=$1", [legacyStudent]);
    }
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



async function team() {
  const section = 'M' + (++n);
  const faculty = await mkFaculty();
  const student = await mkStudent(section);
  await admin.query('insert into public.faculty_advisors(section,faculty_id) values ($1,$2)', [section,faculty]);
  return { section, faculty, student };
}
const apply = (student: string, cgpa: unknown = 9) => as(student, q => q('select public.opt_mooc($1::numeric)', [cgpa]));
const choice = async (student: string) => (await admin.query('select choice from public.students where id=$1', [student])).rows[0].choice;
const queue = (faculty: string, section: string) => as(faculty, async q => (await q('select * from public.fa_mooc_requests($1,null,1)',[section])).rows);
const decide = (faculty: string, id: string, decision: string) => as(faculty, q=>q('select public.respond_mooc_request($1,$2)',[id,decision]));

describe('MOOC Faculty Advisor approval',()=>{
  it('migrates automatic legacy MOOC access to pending and requires a CGPA before approval',async()=>{
    expect(await choice(legacyStudent)).toBe('mooc_pending');
    const [row]=await queue(legacyFaculty,'LEGACY');
    expect(row.cgpa).toBeNull();
    await expect(decide(legacyFaculty,row.request_id,'approved')).rejects.toThrow(/CGPA/);
    await apply(legacyStudent,9);
    await decide(legacyFaculty,row.request_id,'approved');
    expect(await choice(legacyStudent)).toBe('mooc');
  });
  it('uses the current assigned advisor after a section is reassigned',async()=>{
    const t=await team();await apply(t.student);const [row]=await queue(t.faculty,t.section);
    const replacement=await mkFaculty();
    await admin.query('update public.faculty_advisors set faculty_id=$1 where section=$2',[replacement,t.section]);
    await expect(decide(t.faculty,row.request_id,'approved')).rejects.toThrow(/Advisor/);
    await decide(replacement,row.request_id,'approved');expect(await choice(t.student)).toBe('mooc');
  });
  it('does not allow a Minor applicant to submit a MOOC request',async()=>{
    const t=await team();await as(t.student,q=>q('select public.submit_request($1)',[t.faculty]));
    await expect(apply(t.student)).rejects.toThrow(/active Minor/);
  });
  it('accepts exactly 9.00 but leaves access pending until the assigned advisor approves',async()=>{
    const t=await team(); await apply(t.student,9.00);
    expect(await choice(t.student)).toBe('mooc_pending');
    const requests=await queue(t.faculty,t.section);
    expect(requests).toHaveLength(1); expect(Number(requests[0].cgpa)).toBe(9);
    expect(requests[0].student_id).toBe(t.student);
    await decide(t.faculty,requests[0].request_id,'approved');
    expect(await choice(t.student)).toBe('mooc');
    await expect(decide(t.faculty,requests[0].request_id,'declined')).rejects.toThrow(/reviewed/);
  });
  it('rejects invalid CGPAs including nonfinite numeric values',async()=>{
    const t=await team();
    for(const cgpa of [null,0,8.99,10.01,'NaN','Infinity','-Infinity']) await expect(apply(t.student,cgpa)).rejects.toThrow(/CGPA/);
    await apply(t.student,10); expect(await choice(t.student)).toBe('mooc_pending');
  });
  it('blocks cross-section reads, approvals by unrelated faculty, student self-approval and direct writes',async()=>{
    const t=await team(); const other=await mkFaculty(); await apply(t.student);
    const [row]=await queue(t.faculty,t.section);
    await expect(queue(other,t.section)).rejects.toThrow(/Advisor/);
    await expect(decide(other,row.request_id,'approved')).rejects.toThrow(/Advisor/);
    await expect(decide(t.student,row.request_id,'approved')).rejects.toThrow(/not allowed/);
    await expect(as(t.student,q=>q("update public.mooc_requests set status='approved' where id=$1",[row.request_id]))).rejects.toThrow(/permission denied/);
    await expect(as(t.student,q=>q("update public.students set choice='mooc' where id=$1",[t.student]))).rejects.toThrow(/permission denied/);
    const rows=await as(other,async q=>(await q('select * from public.mooc_requests')).rows);expect(rows).toEqual([]);
  });
  it('prevents duplicate requests and simultaneous Minor applications while pending',async()=>{
    const t=await team(); await apply(t.student);
    await expect(apply(t.student)).rejects.toThrow(/pending/);
    await expect(as(t.student,q=>q('select public.submit_request($1)',[t.faculty]))).rejects.toThrow(/MOOC/);
  });
  it('releases a declined student and allows reapplication',async()=>{
    const t=await team(); await apply(t.student);
    const [row]=await queue(t.faculty,t.section);await decide(t.faculty,row.request_id,'declined');expect(await choice(t.student)).toBeNull();
    await apply(t.student,9.5); const rows=await queue(t.faculty,t.section);expect(rows.filter(r=>r.status==='pending')).toHaveLength(1);
  });
  it('requires an assigned advisor and respects global freeze',async()=>{
    const s=await mkStudent('UNMAPPED');await expect(apply(s)).rejects.toThrow(/Advisor/);
    const t=await team();await apply(t.student);const [row]=await queue(t.faculty,t.section);
    await admin.query('update public.system_settings set global_frozen=true where id=1');
    try {await expect(decide(t.faculty,row.request_id,'approved')).rejects.toThrow(/frozen/);} finally {await admin.query('update public.system_settings set global_frozen=false where id=1');}
  });
  it('releases pending requests when an admin resets the choice',async()=>{
    const t=await team();await apply(t.student);const actor=(await mkProfile('admin')).id;
    await as(actor,q=>q('select public.admin_reset_choice($1)',[t.student]));
    expect(await choice(t.student)).toBeNull();
    expect((await queue(t.faculty,t.section))[0].status).toBe('cancelled');
    await apply(t.student,9.5);
    expect((await queue(t.faculty,t.section)).filter(r=>r.status==='pending')).toHaveLength(1);
  });
  it('reports pending separately from approved MOOC in class counts',async()=>{
    const t=await team();await apply(t.student);
    const count=await as(t.faculty,async q=>(await q('select public.fa_class_counts($1) as c',[t.section])).rows[0].c);
    expect(count).toMatchObject({mooc:0,mooc_pending:1,not_opted:0});
  });
});
