import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestGate, createRefreshBatcher } from "@/lib/request-control";

afterEach(() => vi.useRealTimers());

describe("table request lifecycle", () => {
  it("cancels obsolete searches and refuses their late results", () => {
    const gate = createRequestGate();
    const old = gate.start()!;
    const current = gate.start()!;
    expect(old.signal.aborted).toBe(true);
    expect(old.isCurrent()).toBe(false);
    expect(current.isCurrent()).toBe(true);
  });

  it("skips background polls while a request is running", () => {
    const gate = createRequestGate();
    const current = gate.start()!;
    expect(gate.start(true)).toBeNull();
    expect(current.signal.aborted).toBe(false);
    current.finish();
    expect(gate.start(true)).not.toBeNull();
  });

  it("an old completion cannot release a newer request", () => {
    const gate = createRequestGate();
    const old = gate.start()!;
    gate.start();
    old.finish();
    expect(gate.start(true)).toBeNull();
  });

  it("cancels work when a table unmounts", () => {
    const gate = createRequestGate();
    const current = gate.start()!;
    gate.cancel();
    expect(current.signal.aborted).toBe(true);
    expect(current.isCurrent()).toBe(false);
  });
});

describe("realtime event batching", () => {
  it("turns a burst of row changes into one refresh", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const batcher = createRefreshBatcher(refresh);
    for (let i = 0; i < 20; i++) batcher.schedule();
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    batcher.schedule();
    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh a component after cleanup", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const batcher = createRefreshBatcher(refresh);
    batcher.schedule();
    batcher.cancel();
    vi.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();
  });
});
