import "server-only";
import { NextResponse } from "next/server";

/** Never serialize infrastructure exceptions or credentials into an API response. */
export function safeApi(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { return await handler(request); }
    catch {
      return NextResponse.json({ error: "Temporarily unavailable. Please try again shortly." }, { status: 503 });
    }
  };
}
