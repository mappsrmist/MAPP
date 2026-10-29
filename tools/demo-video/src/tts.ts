import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CACHE_DIR } from "./paths";

const run = promisify(execFile);
export const VOICE = "en-IN-PrabhatNeural";

export async function mediaSeconds(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  return Number(stdout.trim());
}

/** Narration clip for `text`, cached by content so re-recordings don't re-synthesize unchanged lines. */
export async function synth(text: string): Promise<{ path: string; sec: number }> {
  const path = join(CACHE_DIR, `${createHash("sha1").update(`${VOICE}|${text}`).digest("hex")}.mp3`);
  if (!existsSync(path)) {
    await run("python", ["-m", "edge_tts", "--voice", VOICE, "--rate", "-5%", "--text", text, "--write-media", path]);
  }
  return { path, sec: await mediaSeconds(path) };
}
