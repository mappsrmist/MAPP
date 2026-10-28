import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isSameOrigin, MAX_BODY_BYTES, readJsonBody } from "@/lib/server/origin";
import { loginKeys } from "@/lib/server/throttle";
import { importRequestSchema, studentRowSchema } from "@/lib/validators";

describe("import payload boundaries", () => {
  it("rejects nested cell payloads and unexpected privilege fields", () => {
    expect(importRequestSchema.safeParse({ type: "students", rows: [{ name: { nested: true } }] }).success).toBe(false);
    expect(importRequestSchema.safeParse({ type: "students", rows: [{ role: "admin" }] }).success).toBe(false);
    expect(studentRowSchema.safeParse({ reg_no: "123456", name: "A", dept: "CSE", section: "A", role: "admin" }).success).toBe(false);
  });
  it("rejects oversized cell values and out-of-range chunks", () => {
    expect(importRequestSchema.safeParse({ type: "students", rows: [{ name: "x".repeat(501) }] }).success).toBe(false);
    expect(importRequestSchema.safeParse({ type: "students", offset: 5000, rows: [{ name: "A" }] }).success).toBe(false);
  });
});

describe("request boundaries", () => {
  it("rejects a same-host origin with a different protocol", () => {
    expect(isSameOrigin(new Request("https://portal.example/api", {
      headers: { origin: "http://portal.example", host: "portal.example" },
    }))).toBe(false);
  });

  it("accepts a matching origin", () => {
    expect(isSameOrigin(new Request("https://portal.example/api", {
      headers: { origin: "https://portal.example", host: "portal.example" },
    }))).toBe(true);
  });

  it("limits actual bytes even without Content-Length", async () => {
    const request = new Request("https://portal.example/api", {
      method: "POST", body: JSON.stringify({ value: "x".repeat(MAX_BODY_BYTES) }),
    });
    await expect(readJsonBody(request)).resolves.toBeNull();
  });

  it("parses valid JSON and rejects invalid JSON", async () => {
    const req = (body: string) => new Request("https://portal.example/api", { method: "POST", body });
    await expect(readJsonBody(req('{"value":1}'))).resolves.toEqual({ value: 1 });
    await expect(readJsonBody(req("{"))).resolves.toBeNull();
  });
  it("rejects invalid UTF-8 rather than silently replacing bytes", async () => {
    const request = new Request("https://portal.example/api", { method: "POST", body: new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]) });
    await expect(readJsonBody(request)).resolves.toBeNull();
  });
});

describe("account throttling", () => {
  it("uses the same counters for all aliases of the admin account", () => {
    expect(loginKeys("admin", "admin", "127.0.0.1"))
      .toEqual(loginKeys("admin", "mappCtech", "127.0.0.1"));
  });
});
