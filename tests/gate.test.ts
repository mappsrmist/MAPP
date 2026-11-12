import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createGate } from "@/lib/server/gate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createGate", () => {
  it("never runs more than maxActive jobs at once and runs all within the wait limit", async () => {
    const gate = createGate(2, 1000, 10);
    let running = 0;
    let peak = 0;
    const job = async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(20);
      running--;
      return "ok";
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => gate.run(job)));
    expect(results.every((r) => r === "ok")).toBe(true);
    expect(peak).toBe(2);
  });

  it("returns null when the queue is full or the wait is too long", async () => {
    const gate = createGate(1, 30, 1);
    const slow = gate.run(() => sleep(100));
    const queued = gate.run(async () => "late"); // waits, times out after 30ms
    const overflow = await gate.run(async () => "x"); // queue already holds one waiter
    expect(overflow).toBeNull();
    expect(await queued).toBeNull();
    await slow;
    expect(await gate.run(async () => "after")).toBe("after");
  });
});
