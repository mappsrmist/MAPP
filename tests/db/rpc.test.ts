/**
 * Database tests. Boots a throw-away real Postgres (embedded-postgres, no Docker),
 * stubs the Supabase `auth` schema/roles, applies supabase/migrations/*.sql, then
 * exercises the RPCs and RLS exactly as an authenticated Supabase user would.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 54329;
let server: EmbeddedPostgres;
let admin: Client; // superuser connection (setup + assertions)
const dataDir = mkdtempSync(join(tmpdir(), "mapp-pg-"));

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
create table auth.identities (
  id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
create publication supabase_realtime;
-- Supabase hands EXECUTE / table rights to anon + authenticated by default; mimic that so the
-- migrations' explicit revokes are really tested.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

async function connect(): Promise<Client> {
  const c = new Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database: "mapp" });
  await c.connect();
  return c;
}

/** Run `fn` as an authenticated Supabase user (role + JWT subject), in one transaction. */
async function as<T>(userId: string | null, fn: (q: Client["query"]) => Promise<T>, client = admin): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.sub', $1, true)", [userId ?? ""]);
    const out = await fn(client.query.bind(client) as Client["query"]);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

let n = 0;
async function mkProfile(role: string, mustChange = false) {
  const id = randomUUID();
  const k = ++n; // captured locally: helpers run concurrently under Promise.all
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, `u${k}@x.test`]);
  await admin.query(
    "insert into public.profiles (id, role, username, must_change_password) values ($1,$2,$3,$4)",
    [id, role, `user${k}`, mustChange],
  );
  return { id, k };
}
async function mkStudent(mustChange = false) {
  const { id, k } = await mkProfile("student", mustChange);
  await admin.query("insert into public.students (id, reg_no, name, dept) values ($1,$2,$3,'CSE')", [id, `RA${k}`, `Student ${k}`]);
  return id;
}
async function mkFaculty(cadre: "HOD" | "ASSOC_CHAIR" | "OTHER" = "OTHER", domains: string[] = ["AI"]) {
  const { id, k } = await mkProfile("faculty");
  await admin.query(
    "insert into public.faculty (id, emp_id, name, srm_email, designation, cadre, phone, venue, domains) values ($1,$2,$3,$4,'Prof',$5,'9999999999','Room 1',$6)",
    [id, `E${k}`, `Faculty ${k}`, `f${k}@srmist.edu.in`, cadre, domains],
  );
  return id;
}
const request = (s: string, f: string) =>
  as(s, async (q) => (await q("select public.submit_request($1) as id", [f])).rows[0].id as string);
const respond = (f: string, rid: string, status: string, c = admin) =>
  as(f, (q) => q("select public.respond_request($1,$2)", [rid, status]), c);
const choiceOf = async (s: string) =>
  (await admin.query("select choice from public.students where id=$1", [s])).rows[0].choice;

beforeAll(async () => {
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  await server.createDatabase("mapp");
  admin = await connect();
  await admin.query(STUB);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(join(dir, f), "utf8"));
  }
}, 120_000);

afterAll(async () => {
  await admin?.end();
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
}, 60_000);

describe("cadre -> seats / batches (e)", () => {
  it("derives seats from cadre via trigger and helper functions", async () => {
    const hod = await mkFaculty("HOD");
    const assoc = await mkFaculty("ASSOC_CHAIR");
    const other = await mkFaculty("OTHER");
    const rows = (await admin.query("select id, total_seats, available_seats from public.faculty where id = any($1)", [[hod, assoc, other]])).rows;
    const seats = Object.fromEntries(rows.map((r) => [r.id, r.total_seats]));
    expect(seats[hod]).toBe(6);
    expect(seats[assoc]).toBe(4);
    expect(seats[other]).toBe(8);
    const b = (await admin.query("select cadre_batches('HOD') h, cadre_batches('ASSOC_CHAIR') a, cadre_batches('OTHER') o")).rows[0];
    expect([b.h, b.a, b.o]).toEqual([3, 2, 4]);
  });

  it("recomputes seats when the cadre changes", async () => {
    const f = await mkFaculty("ASSOC_CHAIR");
    await admin.query("update public.faculty set cadre='HOD' where id=$1", [f]);
    expect((await admin.query("select total_seats from public.faculty where id=$1", [f])).rows[0].total_seats).toBe(6);
  });
});

describe("one student = one request (a)", () => {
  it("rejects a second active request via RPC", async () => {
    const s = await mkStudent();
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    await request(s, f1);
    await expect(request(s, f2)).rejects.toThrow(/already have an active/i);
  });

  it("is enforced by a unique index even if the RPC is bypassed", async () => {
    const s = await mkStudent();
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    await admin.query("insert into public.requests (student_id, faculty_id) values ($1,$2)", [s, f1]);
    await expect(admin.query("insert into public.requests (student_id, faculty_id) values ($1,$2)", [s, f2])).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("capacity (b)", () => {
  it("accepting beyond capacity fails; pending requests do not reserve seats", async () => {
    const f = await mkFaculty("ASSOC_CHAIR"); // 4 seats
    const students = await Promise.all(Array.from({ length: 5 }, () => mkStudent()));
    const rids: string[] = [];
    for (const s of students) rids.push(await request(s, f)); // 5 pending > 4 seats is allowed
    for (const r of rids.slice(0, 4)) await respond(f, r, "accepted");
    await expect(respond(f, rids[4], "accepted")).rejects.toThrow(/no seats/i);
    const row = (await admin.query("select accepted_count, available_seats from public.faculty where id=$1", [f])).rows[0];
    expect(row).toEqual({ accepted_count: 4, available_seats: 0 });
    // the last one can still be declined
    await respond(f, rids[4], "declined");
  });

  it("two concurrent accepts for the last seat: exactly one wins", async () => {
    const f = await mkFaculty("ASSOC_CHAIR");
    const students = await Promise.all(Array.from({ length: 5 }, () => mkStudent()));
    const rids: string[] = [];
    for (const s of students) rids.push(await request(s, f));
    for (const r of rids.slice(0, 3)) await respond(f, r, "accepted"); // 1 seat left
    const c2 = await connect();
    try {
      const res = await Promise.allSettled([respond(f, rids[3], "accepted"), respond(f, rids[4], "accepted", c2)]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await admin.query("select accepted_count from public.faculty where id=$1", [f])).rows[0].accepted_count).toBe(4);
    } finally {
      await c2.end();
    }
  });

  it("a faculty cannot respond to another faculty's request", async () => {
    const s = await mkStudent();
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    const r = await request(s, f1);
    await expect(respond(f2, r, "accepted")).rejects.toThrow(/not found/i);
  });

  it("hides faculty with no seats from the student list", async () => {
    const f = await mkFaculty("ASSOC_CHAIR", ["Zeta-Domain"]);
    for (let i = 0; i < 4; i++) {
      const s = await mkStudent();
      await respond(f, await request(s, f), "accepted");
    }
    const viewer = await mkStudent();
    const rows = await as(viewer, async (q) => (await q("select * from public.list_faculty(null, 'Zeta-Domain', 1)")).rows);
    expect(rows).toHaveLength(0);
  });
});

describe("decline unlocks Minor (c)", () => {
  it("clears the student's choice so they can request someone else", async () => {
    const s = await mkStudent();
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    const r = await request(s, f1);
    expect(await choiceOf(s)).toBe("minor");
    await respond(f1, r, "declined");
    expect(await choiceOf(s)).toBeNull();
    await expect(request(s, f2)).resolves.toBeTruthy();
    const status = await as(s, async (q) => (await q("select * from public.my_minor_status()")).rows[0]);
    expect(status.status).toBe("pending");
    expect(status.faculty_id).toBe(f2);
  });

  it("admin removal frees the seat and unlocks the student", async () => {
    const s = await mkStudent();
    const f = await mkFaculty();
    const r = await request(s, f);
    await respond(f, r, "accepted");
    const { id: adminId } = await mkProfile("admin");
    await as(adminId, (q) => q("select public.admin_remove_accepted($1)", [r]));
    expect((await admin.query("select accepted_count from public.faculty where id=$1", [f])).rows[0].accepted_count).toBe(0);
    expect(await choiceOf(s)).toBeNull();
  });

  it("admin removal cleans up the batch if the removed student was placed in one", async () => {
    const s1 = await mkStudent();
    const s2 = await mkStudent();
    const f = await mkFaculty();
    const r1 = await request(s1, f);
    const r2 = await request(s2, f);
    await respond(f, r1, "accepted");
    await respond(f, r2, "accepted");
    await as(f, (q) =>
      q("select public.save_batch($1, $2, $3, 'A', 'Dr X', '9876543210', 'x@srmist.edu.in')", [1, s1, s2]),
    );
    expect((await admin.query("select count(*) from public.batches where faculty_id=$1", [f])).rows[0].count).toBe("1");

    const { id: adminId } = await mkProfile("admin");
    await as(adminId, (q) => q("select public.admin_remove_accepted($1)", [r1]));

    // Batch was cleanly removed so the remaining student returns to unassigned
    expect((await admin.query("select count(*) from public.batches where faculty_id=$1", [f])).rows[0].count).toBe("0");
    expect((await admin.query("select count(*) from public.batch_members where student_id=$1", [s2])).rows[0].count).toBe("0");
    // s2 is still accepted with faculty
    expect((await admin.query("select status from public.requests where id=$1", [r2])).rows[0].status).toBe("accepted");
  });
});

describe("MOOC <-> Minor exclusivity (d)", () => {
  it("opting MOOC locks Minor (RPC level)", async () => {
    const s = await mkStudent();
    const f = await mkFaculty();
    await as(s, (q) => q("select public.opt_mooc()"));
    await expect(request(s, f)).rejects.toThrow(/MOOC/);
    await expect(as(s, (q) => q("select * from public.list_faculty(null,null,1)"))).rejects.toThrow(/unavailable/i);
    await expect(as(s, (q) => q("select * from public.get_faculty($1)", [f]))).rejects.toThrow(/unavailable/i);
  });

  it("an active Minor request blocks MOOC", async () => {
    const s = await mkStudent();
    const f = await mkFaculty();
    await request(s, f);
    await expect(as(s, (q) => q("select public.opt_mooc()"))).rejects.toThrow(/active Minor/i);
  });

  it("cannot opt for MOOC twice", async () => {
    const s = await mkStudent();
    await as(s, (q) => q("select public.opt_mooc()"));
    await expect(as(s, (q) => q("select public.opt_mooc()"))).rejects.toThrow(/already opted/i);
  });
});

describe("batches", () => {
  it("only accepted students, no duplicates across batches", async () => {
    const f = await mkFaculty("OTHER");
    const [a, b, c, d] = await Promise.all([mkStudent(), mkStudent(), mkStudent(), mkStudent()]);
    for (const s of [a, b, c]) await respond(f, await request(s, f), "accepted");
    const outsider = d;
    const save = (no: number, s1: string, s2: string) =>
      as(f, (q) => q("select public.save_batch($1,$2,$3,'A','Dr X','9876543210','x@srmist.edu.in')", [no, s1, s2]));
    await expect(save(1, a, outsider)).rejects.toThrow(/accepted by you/i);
    await save(1, a, b);
    await expect(save(2, b, c)).rejects.toThrow(/another batch/i);
    await expect(save(5, a, b)).rejects.toThrow(/Invalid batch/i);
    await save(1, a, c); // editing batch 1 re-uses its own members
    await as(f, (q) => q("select public.clear_batch(1)"));
    expect((await admin.query("select count(*)::int n from public.batch_members m join public.batches b on b.id=m.batch_id where b.faculty_id=$1", [f])).rows[0].n).toBe(0);
  });

  it("Associate Chair only has batches 1-2", async () => {
    const f = await mkFaculty("ASSOC_CHAIR");
    const [a, b] = await Promise.all([mkStudent(), mkStudent()]);
    for (const s of [a, b]) await respond(f, await request(s, f), "accepted");
    await expect(
      as(f, (q) => q("select public.save_batch(3,$1,$2,'A','Dr X','9876543210','x@srmist.edu.in')", [a, b])),
    ).rejects.toThrow(/Invalid batch/i);
  });
});

describe("RLS & privileges", () => {
  it("students cannot write choice or read faculty directly", async () => {
    const s = await mkStudent();
    await mkFaculty();
    await expect(as(s, (q) => q("update public.students set choice='mooc' where id=$1", [s]))).rejects.toThrow(/permission denied/i);
    const rows = await as(s, async (q) => (await q("select * from public.faculty")).rows);
    expect(rows).toHaveLength(0);
  });

  it("faculty cannot edit seats or role", async () => {
    const f = await mkFaculty();
    await expect(as(f, (q) => q("update public.faculty set accepted_count=0 where id=$1", [f]))).rejects.toThrow(/permission denied/i);
    await expect(as(f, (q) => q("update public.profiles set role='admin' where id=$1", [f]))).rejects.toThrow(/permission denied/i);
  });

  it("faculty only see students who requested them", async () => {
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    const s1 = await mkStudent();
    const s2 = await mkStudent();
    await request(s1, f1);
    await request(s2, f2);
    const seen = await as(f1, async (q) => (await q("select id from public.students")).rows.map((r) => r.id));
    expect(seen).toEqual([s1]);
    const reqs = await as(f1, async (q) => (await q("select student_id from public.request_details_v")).rows.map((r) => r.student_id));
    expect(reqs).toEqual([s1]);
  });

  it("users who still must change their password are blocked", async () => {
    const s = await mkStudent(true);
    await expect(as(s, (q) => q("select public.opt_mooc()"))).rejects.toThrow(/change your password/i);
    const rows = await as(s, async (q) => (await q("select * from public.students")).rows);
    expect(rows).toHaveLength(1); // may still read own row (needed to render the forced-change screen)
  });

  it("non-admins cannot call admin RPCs", async () => {
    const s = await mkStudent();
    await expect(as(s, (q) => q("select public.admin_stats()"))).rejects.toThrow(/not allowed/i);
  });
});

describe("privileges (hardening)", () => {
  it("internal helpers and trigger functions are not callable through the API", async () => {
    const s = await mkStudent();
    await expect(as(s, (q) => q("select public._assert_role('student')"))).rejects.toThrow(/permission denied/i);
    await expect(as(s, (q) => q("select public._assert_minor_open()"))).rejects.toThrow(/permission denied/i);
  });

  it("anon can neither call RPCs nor read tables", async () => {
    const run = async (sql: string) => {
      await admin.query("begin");
      try {
        await admin.query("set local role anon");
        await admin.query(sql);
      } finally {
        await admin.query("rollback");
      }
    };
    await expect(run("select public.opt_mooc()")).rejects.toThrow(/permission denied/i);
    await expect(run("select public.list_faculty(null,null,1)")).rejects.toThrow(/permission denied/i);
    await expect(run("select * from public.students")).rejects.toThrow(/permission denied/i);
    await expect(run("select * from public.request_details_v")).rejects.toThrow(/permission denied/i);
  });

  it("faculty can read their own batches and members (RLS) but not another faculty's", async () => {
    const f1 = await mkFaculty();
    const f2 = await mkFaculty();
    const [a, b] = await Promise.all([mkStudent(), mkStudent()]);
    for (const s of [a, b]) await respond(f1, await request(s, f1), "accepted");
    await as(f1, (q) => q("select public.save_batch(1,$1,$2,'A','Dr X','9876543210','x@srmist.edu.in')", [a, b]));
    const own = await as(f1, async (q) => (await q("select count(*)::int n from public.batch_members")).rows[0].n);
    const other = await as(f2, async (q) => (await q("select count(*)::int n from public.batch_members")).rows[0].n);
    expect(own).toBe(2);
    expect(other).toBe(0);
  });
});

describe("seed.sql", () => {
  it("creates the demo data and is re-runnable", async () => {
    const seed = readFileSync(join(process.cwd(), "supabase", "seed.sql"), "utf8");
    await admin.query(seed);
    await admin.query(seed); // idempotent
    const count = async (sql: string) => (await admin.query(sql)).rows[0].n as number;
    expect(await count("select count(*)::int n from public.faculty where emp_id ~ '^E100[1-5]$'")).toBe(5);
    expect(await count("select count(*)::int n from public.faculty where emp_id ~ '^E100[1-5]$' and cadre='HOD'")).toBe(1);
    expect(await count("select count(*)::int n from public.faculty where emp_id ~ '^E100[1-5]$' and cadre='ASSOC_CHAIR'")).toBe(1);
    expect(await count("select count(*)::int n from public.students where reg_no like 'RA241100301000%' or reg_no like 'RA241100301001%' or reg_no like 'RA241100301002%' or reg_no = 'RA2411003010030'")).toBe(30);
    // faculty initial password is DDMMYYYY of the DOB
    const hash = (await admin.query("select u.encrypted_password = extensions.crypt('14031972', u.encrypted_password) ok from auth.users u where u.email='ramesh.k@srmist.edu.in'")).rows[0];
    expect(hash.ok).toBe(true);
  });
});
