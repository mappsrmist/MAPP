import { chromium, type Locator, type Page } from "playwright";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { overlayScript } from "./cursor";
import { MARKER_OFF, MARKER_ON } from "./marker";
import { RAW_DIR } from "./paths";
import type { StepLog } from "./timeline";
import { synth } from "./tts";

/** One narrated moment of a video. Off-camera actions (another user's RPC) run inside a step's `run`. */
export type Step = { caption: string; narration: string; run: (page: Page) => Promise<void> };

const PAD_SEC = 0.5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Records `steps` in a 1920x1080 light-theme browser. Each step is held until its narration has finished.
 * The footage before the first step (blank page, first load of `startUrl`) is excluded via `trimStartSec`.
 */
export async function record(name: string, startUrl: string, steps: Step[]): Promise<{ videoPath: string; logs: StepLog[]; trimStartSec: number; markSec: number }> {
  const audio = await Promise.all(steps.map((s) => synth(s.narration)));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    acceptDownloads: true,
    recordVideo: { dir: RAW_DIR, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript({ content: overlayScript });
  const page = await context.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const logs: StepLog[] = [];
  let failure: Error | null = null;
  try {
    await page.goto(startUrl);
    await page.mouse.move(960, 540);
    await sleep(800);
    // a magenta flash whose frame the assembler finds, to map this clock onto the video's clock
    await page.evaluate(MARKER_ON);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const markSec = now();
    await sleep(500);
    await page.evaluate(MARKER_OFF);
    await sleep(700);
    const trimStartSec = now();
    for (const [i, step] of steps.entries()) {
      const startSec = now();
      logs.push({ caption: step.caption, audioPath: audio[i].path, audioSec: audio[i].sec, startSec: startSec - trimStartSec });
      await step.run(page);
      const wait = startSec + audio[i].sec + PAD_SEC - now();
      if (wait > 0) await sleep(wait * 1000);
      const err = await page.evaluate(() => (window as unknown as { __demoError?: string }).__demoError ?? null).catch(() => null);
      if (err) throw new Error(`Error toast on screen during "${step.caption}": ${err}`);
    }
    await sleep(1000);
    const video = page.video()!;
    await context.close();
    const videoPath = join(RAW_DIR, `${name}.webm`);
    renameSync(await video.path(), videoPath);
    return { videoPath, logs, trimStartSec, markSec };
  } catch (e) {
    failure = e as Error;
    await page.screenshot({ path: join(RAW_DIR, `${name}-failure.png`) }).catch(() => {});
    throw failure;
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }
}

/** Moves the visible cursor smoothly to the element, then clicks it. */
export async function click(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
    await sleep(250);
  }
  await target.click();
  await sleep(400);
}

/** Clicks into a field and types like a person. */
export async function type(page: Page, target: Locator, text: string) {
  await click(page, target);
  await target.fill("");
  await target.pressSequentially(text, { delay: 65 });
  await sleep(300);
}

export const pause = (sec: number) => sleep(sec * 1000);
