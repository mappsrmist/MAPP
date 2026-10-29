/** One recorded step: when it started in the raw recording and the narration clip that goes with it. */
export type StepLog = { caption: string; audioPath: string; audioSec: number; startSec: number };

export type TimelineEntry = { caption: string; audioPath: string; startSec: number; endSec: number };

/**
 * Captions stay on screen until the next step starts (a slow action keeps its caption up) and never overlap it.
 * The last caption ends when its narration does.
 */
export function buildTimeline(logs: StepLog[]): TimelineEntry[] {
  return logs.map((l, i) => {
    const next = logs[i + 1];
    return { caption: l.caption, audioPath: l.audioPath, startSec: l.startSec, endSec: next ? next.startSec : l.startSec + l.audioSec };
  });
}

function stamp(sec: number): string {
  const ms = Math.round(sec * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function toSrt(entries: { caption: string; startSec: number; endSec: number }[]): string {
  return entries.map((e, i) => `${i + 1}\n${stamp(e.startSec)} --> ${stamp(e.endSec)}\n${e.caption}\n`).join("\n");
}
