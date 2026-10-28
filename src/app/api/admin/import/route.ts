import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin } from "@/lib/server/origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/guards";
import { upsertFaculty, upsertStudent, type Upserted } from "@/lib/server/importers";
import { facultyRowSchema, importRequestSchema, studentRowSchema } from "@/lib/validators";

export const maxDuration = 60;

interface RowError {
  row: number; // 1-based data row number in the uploaded file
  message: string;
}

interface Credential {
  username: string;
  name: string;
  password: string;
}

/**
 * Imports one chunk (<=100 rows) of students or faculty. The client sends the CSV in chunks.
 * New accounts get a random one-time password, returned once in `credentials` and never stored.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = importRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
  const { type, rows, offset } = body.data;

  const admin = createAdminClient();
  const errors: RowError[] = [];
  const credentials: Credential[] = [];
  let created = 0;
  let updated = 0;

  const record = (res: Upserted, username: string, name: string) => {
    if (res.created && res.password) {
      created++;
      credentials.push({ username, name, password: res.password });
    } else {
      updated++;
    }
  };

  const work = rows.map((raw, i) => async () => {
    const rowNo = offset + i + 1;
    try {
      if (type === "students") {
        const r = studentRowSchema.safeParse(raw);
        if (!r.success) throw new Error(r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "));
        record(await upsertStudent(admin, r.data), r.data.reg_no, r.data.name);
      } else {
        const r = facultyRowSchema.safeParse(raw);
        if (!r.success) throw new Error(r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "));
        record(await upsertFaculty(admin, r.data), r.data.srm_email, r.data.name);
      }
    } catch (e) {
      errors.push({ row: rowNo, message: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // small worker pool: parallel enough to be quick, gentle on the Auth API
  const queue = [...work];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (job) await job();
      }
    }),
  );

  errors.sort((a, b) => a.row - b.row);
  return NextResponse.json({ created, updated, errors, credentials });
}
