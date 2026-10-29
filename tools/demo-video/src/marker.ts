import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const FPS = 30;

/** Seconds into the video where the full-screen magenta sync marker first shows (scans the first 30 s). */
export async function findMarkerSec(video: string): Promise<number> {
  const { stdout } = await run(
    "ffmpeg",
    ["-v", "error", "-t", "30", "-i", video, "-vf", `fps=${FPS},scale=4:4`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  const frame = 4 * 4 * 3;
  for (let i = 0; i * frame < stdout.length; i++) {
    const px = i * frame + (2 * 4 + 2) * 3; // a centre pixel
    const [r, g, b] = [stdout[px], stdout[px + 1], stdout[px + 2]];
    if (r > 200 && g < 80 && b > 200) return i / FPS;
  }
  throw new Error("Sync marker not found in the recording");
}

/** Shows the marker in the page; call it, note the wall-clock time, then let the recording continue. */
export const MARKER_ON = `(() => { const m = document.createElement("div"); m.id = "__demo-sync";
  Object.assign(m.style, { position: "fixed", inset: "0", background: "#ff00ff", zIndex: "2147483647" });
  document.body.appendChild(m); })()`;
export const MARKER_OFF = `document.getElementById("__demo-sync")?.remove()`;
