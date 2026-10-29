import { describe, expect, it } from "vitest";
import { buildTimeline, toSrt } from "../src/timeline";

const log = (startSec: number, audioSec: number, caption = "x") => ({ caption, audioPath: `${caption}.mp3`, audioSec, startSec });

describe("toSrt", () => {
  it("formats one cue", () => {
    expect(toSrt([{ caption: "Login", startSec: 0, endSec: 2.5 }])).toBe("1\n00:00:00,000 --> 00:00:02,500\nLogin\n");
  });
  it("formats hours/minutes and separates cues with a blank line", () => {
    expect(toSrt([{ caption: "a", startSec: 61.25, endSec: 3725.5 }, { caption: "b", startSec: 3726, endSec: 3727 }])).toBe(
      "1\n00:01:01,250 --> 01:02:05,500\na\n\n2\n01:02:06,000 --> 01:02:07,000\nb\n",
    );
  });
});

describe("buildTimeline", () => {
  it("holds each caption until the next step starts", () => {
    const t = buildTimeline([log(0, 3), log(5, 2)]);
    expect(t.map((e) => [e.startSec, e.endSec])).toEqual([[0, 5], [5, 7]]);
  });
  it("keeps captions up while a long action runs, without overlapping the next", () => {
    const t = buildTimeline([log(0, 2), log(6, 1)]);
    expect(t[0].endSec).toBe(6);
    expect(t[1].startSec).toBe(6);
  });
  it("never lets a caption run past the next start even if audio is longer", () => {
    const t = buildTimeline([log(0, 4), log(3, 1)]);
    expect(t[0].endSec).toBe(3);
  });
});
