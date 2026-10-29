import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), lookup: vi.fn(), updateUserById: vi.fn(), requireAdmin: vi.fn(),
}));
vi.mock("@/lib/server/guards", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => ({ select: () => ({ in: mocks.lookup }) }),
  auth: { admin: { updateUserById: mocks.updateUserById } },
}) }));
import { POST } from "@/app/api/admin/students/route";

const studentId = "11111111-1111-4111-8111-111111111111";
const facultyId = "22222222-2222-4222-8222-222222222222";
const request = (action: string, ids: string[]) => new Request("https://portal.example/api/admin/students", {
  method: "POST", headers: { origin: "https://portal.example" }, body: JSON.stringify({ action, ids }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin" });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  mocks.lookup.mockResolvedValue({ data: [{ id: studentId }], error: null });
  mocks.updateUserById.mockResolvedValue({ error: null });
});

describe("student login access administration", () => {
  it.each(["remove", "restore"])("rejects %s of mixed student and nonstudent accounts before any mutation", async (action) => {
    const response = await POST(request(action, [studentId, facultyId]));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("fails closed when the student lookup fails", async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const response = await POST(request("remove", [studentId]));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([["remove", "876000h"], ["restore", "none"]])("allows %s for verified students", async (action, ban) => {
    const response = await POST(request(action, [studentId]));
    expect(response.status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledWith(studentId, { ban_duration: ban });
  });
});
