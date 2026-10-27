import type { Op, QueryReq, Result, RpcReq } from "./store";

export const isMock = () => process.env.NEXT_PUBLIC_MOCK === "1" && process.env.NODE_ENV !== "production";

export const MOCK_COOKIE = "mock_session"; // value: "<role>.<profile id>"

type Exec = (req: QueryReq | RpcReq) => Promise<Result>;

/** Records a PostgREST-style chain and runs it through `exec` when awaited. */
class Builder implements PromiseLike<Result> {
  private ops: Op[] = [];
  constructor(private exec: Exec, private table: string) {}
  private add(...op: Op) {
    this.ops.push(op);
    return this;
  }
  select(cols = "*", opts?: unknown) { return this.add("select", cols, opts); }
  eq(c: string, v: unknown) { return this.add("eq", c, v); }
  is(c: string, v: unknown) { return this.add("is", c, v); }
  or(f: string) { return this.add("or", f); }
  order(c: string, o?: unknown) { return this.add("order", c, o); }
  range(a: number, b: number) { return this.add("range", a, b); }
  limit(n: number) { return this.add("limit", n); }
  single() { return this.add("single"); }
  maybeSingle() { return this.add("maybeSingle"); }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, err?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.exec({ kind: "query", table: this.table, ops: this.ops }).then(ok, err);
  }
}

/** A Supabase-shaped client backed by `exec`. Auth/realtime are stubbed. */
export function makeMockClient(exec: Exec, auth: Record<string, unknown>) {
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    from: (table: string) => new Builder(exec, table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => ({ then: (ok: (v: Result) => unknown, err?: (e: unknown) => unknown) => exec({ kind: "rpc", fn, args }).then(ok, err) }),
    channel: () => channel,
    removeChannel: () => undefined,
    auth,
  };
}

/** Browser side: forwards every call to /api/mock (the store lives on the server). */
export function mockBrowserClient() {
  const exec: Exec = async (req) => {
    try {
      const res = await fetch("/api/mock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
      return (await res.json()) as Result;
    } catch {
      return { data: null, error: { message: "Mock backend unreachable" } };
    }
  };
  return makeMockClient(exec, {
    signOut: async () => {
      await fetch("/api/mock", { method: "DELETE" });
      return { error: null };
    },
  });
}
