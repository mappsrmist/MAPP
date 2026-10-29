import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { record } from "../src/recorder";
import { synth } from "../src/tts";

const PAGE = "data:text/html,<html><body style='font:32px sans-serif'><h1>Demo test page</h1></body></html>";

describe("synth", () => {
  it("renders narration to an mp3 and measures it", async () => {
    const a = await synth("Testing the narration voice.");
    expect(existsSync(a.path)).toBe(true);
    expect(a.sec).toBeGreaterThan(0.5);
  });
});

describe("record", () => {
  it("logs each step's start and narration length and produces a video", async () => {
    const r = await record("test-ok", PAGE, [{ caption: "Hello", narration: "Hello there.", run: async () => {} }]);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0].startSec).toBeGreaterThanOrEqual(0);
    expect(r.logs[0].audioSec).toBeGreaterThan(0);
    expect(existsSync(r.videoPath)).toBe(true);
  });

  it("fails the run when an error toast appears on screen", async () => {
    await expect(
      record("test-err", PAGE, [
        {
          caption: "Break",
          narration: "Something goes wrong.",
          run: async (page) => {
            await page.evaluate(() => {
              const t = document.createElement("li");
              t.setAttribute("data-sonner-toast", "");
              t.setAttribute("data-type", "error");
              t.textContent = "Boom";
              document.body.appendChild(t);
              setTimeout(() => t.remove(), 200); // gone long before the narration ends
            });
          },
        },
      ]),
    ).rejects.toThrow(/Error toast on screen during "Break": Boom/);
  });
});
