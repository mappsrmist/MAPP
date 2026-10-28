import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RequestBudget { key: string; limit: number; window: number }

/** Atomic store operation before the protected work; successful requests also consume budget. */
export async function enforceRateLimit(budgets: RequestBudget[]): Promise<NextResponse | null> {
  try {
    const admin = createAdminClient();
    let wait = 0;
    for (const budget of budgets) {
      const { data, error } = await admin.rpc("consume_request_budget", {
        p_key: budget.key, p_limit: budget.limit, p_window: budget.window,
      });
      if (error || typeof data !== "number" || !Number.isFinite(data) || data < 0) throw new Error("Limiter unavailable");
      wait = Math.max(wait, data);
      if (wait > 0) break;
    }
    return wait > 0 ? NextResponse.json({ error: "Too many requests. Please try again later." }, {
      status: 429, headers: { "Retry-After": String(Math.ceil(wait)) },
    }) : null;
  } catch {
    return NextResponse.json({ error: "Temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
}
