import { NextResponse } from "next/server";
import { isMock, MOCK_COOKIE } from "@/lib/mock/client";
import { execQuery, execRpc, type QueryReq, type RpcReq } from "@/lib/mock/store";
import { mockUserId } from "@/lib/mock/server";

// DEV-ONLY: serves the in-memory mock backend to the browser client. 404s unless NEXT_PUBLIC_MOCK=1.
export async function POST(request: Request) {
  if (!isMock()) return new NextResponse(null, { status: 404 });
  const req = (await request.json().catch(() => null)) as QueryReq | RpcReq | null;
  if (!req) return NextResponse.json({ data: null, error: { message: "Bad request" } }, { status: 400 });
  const me = await mockUserId();
  return NextResponse.json(req.kind === "rpc" ? execRpc(req, me) : execQuery(req));
}

export async function DELETE() {
  if (!isMock()) return new NextResponse(null, { status: 404 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(MOCK_COOKIE);
  return res;
}
