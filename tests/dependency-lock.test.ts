import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployment dependency lock", () => {
  it("contains a version for every installed package record", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const incomplete = Object.entries(lock.packages as Record<string, { version?: string; link?: boolean }>)
      .filter(([path, pkg]) => path && !pkg.link && (typeof pkg.version !== "string" || !pkg.version.trim()))
      .map(([path]) => path);
    expect(incomplete).toEqual([]);
  });
});
