import { safeApi } from "@/lib/server/safe-api";
import { NextResponse } from "next/server";
import { bodyTooLarge, isSameOrigin, readJsonBody } from "@/lib/server/origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/guards";
import { upsertFaculty, upsertStudent, type Upserted } from "@/lib/server/importers";
import { facultyRowSchema, importRequestSchema, studentRowSchema } from "@/lib/validators";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const maxDuration = 60;

interface RowError {
  row: number; // Excel row number in the uploaded sheet
  message: string;
}

/**
 * Imports one chunk (<=100 rows) of students or faculty. A student row may carry its Faculty Advisor's SRM email. The client parses an Excel workbook and sends validated-size chunks.
 * New accounts start with the registration number / employee ID as password and must change it at first login.
 */
async function handlePost(request: Request) {
  if (!isSameOrigin(request) || bodyTooLarge(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limited = await enforceRateLimit([{ key: `import:${user.id}`, limit: 120, window: 60 }]);
  if (limited) return limited;

  const body = importRequestSchema.safeParse(await readJsonBody(request));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
  const { type, rows, offset, rowNumbers } = body.data;

  const admin = createAdminClient();
  const errors: RowError[] = [];
  let created = 0;
  let updated = 0;

  const record = (res: Upserted) => {
    if (res.created) created++;
    else updated++;
  };

  const work = rows.map((raw, i) => async () => {
    const rowNo = rowNumbers?.[i] ?? offset + i + 2;
    try {
      if (type === "students") {
        const r = studentRowSchema.safeParse(raw);
        if (!r.success) throw new Error(r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "));
        const saved = await upsertStudent(admin, r.data);
        record(saved);
        if (saved.warning) errors.push({ row: rowNo, message: saved.warning });
      } else {
        const r = facultyRowSchema.safeParse(raw);
        if (!r.success) throw new Error(r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "));
        record(await upsertFaculty(admin, r.data));
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
  return NextResponse.json({ created, updated, errors });
}

export const POST = safeApi(handlePost);
