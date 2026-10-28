import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { enforceRateLimit } from "@/lib/server/rate-limit";
beforeEach(() => { rpc.mockReset(); });

describe("shared request budgets", () => {
  const budget = [{ key: "import:verified-user-id", limit: 120, window: 60 }];
  it("consumes the atomic budget before allowing requests", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await enforceRateLimit(budget)).toBeNull();
    expect(rpc).toHaveBeenCalledWith("consume_request_budget", { p_key: budget[0].key, p_limit: 120, p_window: 60 });
  });
  it("returns a retry interval for exhausted budgets", async () => {
    rpc.mockResolvedValue({ data: 42, error: null });
    const response = await enforceRateLimit(budget);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("42");
  });
  it("fails closed without exposing store errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sensitive database detail" } });
    const response = await enforceRateLimit(budget);
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("sensitive");
    rpc.mockRejectedValue(new Error("network"));
    expect((await enforceRateLimit(budget))?.status).toBe(503);
  });
});
