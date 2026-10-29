import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { renderCard } from "./card";
import { OUT_DIR } from "./paths";
import { buildTimeline, toSrt, type StepLog, type TimelineEntry } from "./timeline";
import { findMarkerSec } from "./marker";
import { synth } from "./tts";

const run = promisify(execFile);

const CAPTION_STYLE =
  "FontName=Segoe UI,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H40101418,BackColour=&H40101418,BorderStyle=3,Outline=8,Shadow=0,MarginV=22,Alignment=2";
const VIDEO_FMT = "fps=30,scale=1920:1080,setsar=1,format=yuv420p";

/**
 * One ffmpeg run: intro card, the trimmed recording with burned captions, outro card; narration clips mixed in at
 * intro + step start. Paths are used as given (ffmpeg runs with cwd = the output folder, so the subtitles filter
 * gets a bare file name and needs no Windows drive-letter escaping).
 */
export function ffmpegArgs(o: {
  intro: string;
  outro: string;
  introAudio: string;
  video: string;
  trimStartSec: number;
  introSec: number;
  outroSec: number;
  srt: string;
  out: string;
  timeline: TimelineEntry[];
}): string[] {
  const clips = [{ path: o.introAudio, at: 0.6 }, ...o.timeline.map((e) => ({ path: e.audioPath, at: o.introSec + e.startSec }))];
  const inputs = [
    "-loop", "1", "-t", String(o.introSec), "-i", o.intro,
    "-ss", String(o.trimStartSec), "-i", o.video,
    "-loop", "1", "-t", String(o.outroSec), "-i", o.outro,
    ...clips.flatMap((c) => ["-i", c.path]),
  ];
  const delays = clips.map((c, i) => {
    const ms = Math.round(c.at * 1000);
    return `[${i + 3}:a]adelay=${ms}|${ms}[a${i}]`;
  });
  const filter = [
    `[0:v]${VIDEO_FMT}[v0]`,
    `[1:v]${VIDEO_FMT},subtitles=${o.srt}:force_style='${CAPTION_STYLE}'[v1]`,
    `[2:v]${VIDEO_FMT}[v2]`,
    `[v0][v1][v2]concat=n=3:v=1:a=0[v]`,
    ...delays,
    `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:duration=longest[a]`,
  ].join(";");
  return [
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    o.out,
  ];
}

/** Writes demo-output/MAPP-<name>-Demo.mp4 (+ .srt) from a recording. */
export async function assemble(
  name: "Student" | "Faculty",
  rec: { videoPath: string; logs: StepLog[]; trimStartSec: number; markSec: number },
  cards: { title: string; subtitle: string; introNarration: string; outroTitle: string; outroSubtitle: string },
): Promise<string> {
  const stem = `MAPP-${name}-Demo`;
  const timeline = buildTimeline(rec.logs);
  const srt = `${stem}.srt`;
  writeFileSync(join(OUT_DIR, srt), toSrt(timeline));
  const intro = join(OUT_DIR, "raw", `${stem}-intro.png`);
  const outro = join(OUT_DIR, "raw", `${stem}-outro.png`);
  await renderCard(cards.title, cards.subtitle, intro);
  await renderCard(cards.outroTitle, cards.outroSubtitle, outro);
  const introAudio = await synth(cards.introNarration);
  const out = `${stem}.mp4`;
  // the recorder's clock vs the video's clock, measured from the sync marker frame
  const offset = (await findMarkerSec(rec.videoPath)) - rec.markSec;
  console.log(`video clock offset: ${offset.toFixed(2)}s`);
  const args = ffmpegArgs({
    intro, outro, introAudio: introAudio.path, video: rec.videoPath, trimStartSec: Math.max(0, rec.trimStartSec + offset),
    introSec: Math.max(5, Math.ceil(introAudio.sec + 1.2)), outroSec: 4, srt, out, timeline,
  });
  await run("ffmpeg", args, { cwd: OUT_DIR, maxBuffer: 64 * 1024 * 1024 });
  console.log(`wrote ${join(OUT_DIR, basename(out))}`);
  return join(OUT_DIR, out);
}
