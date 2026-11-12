import { NextResponse } from "next/server";
import { safeApi } from "@/lib/server/safe-api";
import { isSameOrigin } from "@/lib/server/origin";
import { requireAdmin } from "@/lib/server/guards";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { buildMasterWorkbook } from "@/lib/server/master-export";

export const maxDuration = 60;

/** Admin-only, read-only: downloads one workbook with every student and faculty record and their allocations. */
async function handlePost(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limited = await enforceRateLimit([{ key: `master-export:${user.id}`, limit: 5, window: 300 }]);
  if (limited) return limited;

  const buffer = await buildMasterWorkbook();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="MAPP_Master_Data_${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

export const POST = safeApi(handlePost);
