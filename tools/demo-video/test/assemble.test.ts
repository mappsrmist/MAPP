import { describe, expect, it } from "vitest";
import { ffmpegArgs } from "../src/assemble";

const base = {
  intro: "intro.png",
  outro: "outro.png",
  introAudio: "intro.mp3",
  video: "raw.webm",
  trimStartSec: 1.5,
  introSec: 4,
  outroSec: 3,
  srt: "captions.srt",
  out: "final.mp4",
  timeline: [
    { caption: "Login", audioPath: "a.mp3", startSec: 0, endSec: 5 },
    { caption: "Next", audioPath: "b.mp3", startSec: 5, endSec: 9 },
  ],
};

describe("ffmpegArgs", () => {
  const args = ffmpegArgs(base);
  const filter = args[args.indexOf("-filter_complex") + 1];

  it("delays each narration clip by intro length plus its step start", () => {
    expect(filter).toContain("adelay=4000|4000");
    expect(filter).toContain("adelay=9000|9000");
  });
  it("trims the raw recording's blank start", () => {
    expect(args.join(" ")).toContain("-ss 1.5 -i raw.webm");
  });
  it("burns captions onto the recording and concatenates intro, recording, outro", () => {
    expect(filter).toContain("subtitles=captions.srt");
    expect(filter).toContain("concat=n=3:v=1:a=0");
  });
  it("mixes intro narration plus every step clip and writes the output last", () => {
    expect(filter).toContain("amix=inputs=3");
    expect(args.at(-1)).toBe("final.mp4");
  });
});
