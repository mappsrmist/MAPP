import "server-only";
import { cookies } from "next/headers";
import { db, execQuery, execRpc } from "./store";
import { makeMockClient, MOCK_COOKIE } from "./client";

export async function mockUserId(): Promise<string | null> {
  const id = (await cookies()).get(MOCK_COOKIE)?.value.split(".")[1];
  return id && db().profiles.some((p) => p.id === id) ? id : null;
}

/** Server-component / route-handler client reading the mock session cookie. */
export async function mockServerClient() {
  const me = await mockUserId();
  return makeMockClient(async (req) => (req.kind === "rpc" ? execRpc(req, me) : execQuery(req)), {
    getUser: async () => ({ data: { user: me ? { id: me, email: null } : null }, error: null }),
    signOut: async () => {
      (await cookies()).delete(MOCK_COOKIE);
      return { error: null };
    },
  });
}
