import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { RAW_DIR } from "../src/paths";
import { findMarkerSec } from "../src/marker";

describe("findMarkerSec", () => {
  it("finds when the magenta sync marker first appears", async () => {
    const out = join(RAW_DIR, "marker-test.webm");
    // 1.5 s of grey, then magenta
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x180:d=1.5:r=30", "-f", "lavfi", "-i", "color=c=0xFF00FF:s=320x180:d=1:r=30",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", out]);
    expect(await findMarkerSec(out)).toBeCloseTo(1.5, 1);
  });
});
