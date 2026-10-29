import { describe, expect, it } from "vitest";
import { preflight } from "../src/preflight";

/** Minimal stand-in for the two queries preflight makes. */
function stub(frozen: boolean, c1EmpId: string | null) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          table === "system_settings"
            ? { data: { global_frozen: frozen }, error: null }
            : { data: c1EmpId ? { faculty: { emp_id: c1EmpId } } : null, error: null },
      };
      return q;
    },
  } as never;
}

describe("preflight", () => {
  it("refuses when the portal is frozen", async () => {
    await expect(preflight(stub(true, null))).rejects.toThrow(/frozen/);
  });
  it("refuses when C1 belongs to a non-demo advisor", async () => {
    await expect(preflight(stub(false, "EMP12345"))).rejects.toThrow(/C1/);
  });
  it("accepts C1 mapped to the demo advisor", async () => {
    await expect(preflight(stub(false, "EMP90101"))).resolves.toBeUndefined();
  });
  it("accepts a clean, open portal", async () => {
    await expect(preflight(stub(false, null))).resolves.toBeUndefined();
  });
});
