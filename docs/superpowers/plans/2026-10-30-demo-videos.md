# MAPP Demo Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two narrated, captioned 1080p MP4 demos of the real MAPP app: `MAPP-Student-Demo.mp4` and `MAPP-Faculty-Demo.mp4`.

**Architecture:** A self-contained `tools/demo-video/` package. A seed script creates demo accounts in the live (dummy-data) Supabase project through the app's own importers and RPCs. Each video is a list of steps `{caption, narration, run}`. edge-tts renders the narration, Playwright records the real app (local `next start`) while holding each step for its narration length, and ffmpeg lays the narration, burned captions and title cards over the recording.

**Tech Stack:** Node 22 + tsx, Playwright (Chromium), @supabase/supabase-js, dotenv, vitest; Python edge-tts; ffmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-30-demo-videos-design.md`

## Global Constraints

- Two separate output files: `demo-output/MAPP-Student-Demo.mp4`, `demo-output/MAPP-Faculty-Demo.mp4` (1920×1080, H.264 + AAC). `demo-output/` is gitignored.
- Voice: edge-tts `en-IN-PrabhatNeural`.
- Light theme, Chromium viewport 1920×1080.
- Never modify non-demo accounts or `system_settings`. If `system_settings.global_frozen` is true, abort with a clear message.
- Demo section `C1` (A1, A2, B1, B2 are taken). Seeding must abort if `C1` already has a non-demo advisor.
- App dependencies (`/package.json`) stay untouched. All new dependencies go in `tools/demo-video/package.json`.
- Mutations go through the app's RPCs as the acting user (`submit_request`, `respond_request`, `save_batch`, `opt_mooc`, `respond_mooc_request`), never direct table writes. Account creation goes through `src/lib/server/importers.ts`.
- Realistic dummy names, no "Demo" in on-screen names.

## Review Focus

1. **Re-runs:** a second `npm run record:*` after a first run must start from a clean state (Student A not yet MOOC-approved, Dr. Priya with fresh pending requests). `reset` = cleanup + seed, idempotent. Test: `cleanup` then `seed` twice in a row both succeed.
2. **Errors on screen:** an error toast (`[data-sonner-toast][data-type="error"]`) appearing during a recording must fail the run instead of shipping a broken video. Test in Task 3 (`runSteps` throws when the error selector is visible).
3. **Narration vs action length:** when an action takes longer than its narration, the next step's audio must not overlap. Offsets come from logged start times, and each clip is held for at least its own duration. Test in Task 1 (`buildTimeline` with action longer than audio).
4. **Portal frozen / C1 taken:** preflight aborts with a clear message. Test in Task 2 (`preflight` throws on `global_frozen: true`).
5. **Slow page loads:** waits use visible-element locators, not fixed sleeps, so a slow Supabase response doesn't record a spinner over narration.

---

### Task 1: Package scaffold + timeline/SRT core

**Files:**
- Create: `tools/demo-video/package.json`, `tools/demo-video/tsconfig.json`, `tools/demo-video/src/timeline.ts`, `tools/demo-video/test/timeline.test.ts`
- Modify: `.gitignore` (add `demo-output/`, `tools/demo-video/node_modules/`, `tools/demo-video/.cache/`)

**Interfaces:**
- Produces:
  - `type StepLog = { caption: string; audioPath: string; audioSec: number; startSec: number }`
  - `buildTimeline(logs: StepLog[]): { caption: string; audioPath: string; startSec: number; endSec: number }[]`: `endSec = max(startSec + audioSec, nextStart)` capped so captions never overlap.
  - `toSrt(entries: {caption:string; startSec:number; endSec:number}[]): string`: standard SRT, `HH:MM:SS,mmm`.
- Scripts in package.json: `seed`, `cleanup`, `reset`, `record:student`, `record:faculty`, `test` (vitest). Scripts that import app code run `tsx --conditions=react-server --tsconfig ../../tsconfig.json`, so `server-only` and `@/` resolve.

- [ ] **Step 1: Write failing tests** `test/timeline.test.ts`:
  - `toSrt([{caption:"Login", startSec:0, endSec:2.5}])` equals `"1\n00:00:00,000 --> 00:00:02,500\nLogin\n"`.
  - `buildTimeline` with logs `[{start 0, audio 3}, {start 5, audio 2}]` → entry 0 `endSec` 5, entry 1 `endSec` 7.
  - Action longer than audio: `[{start 0, audio 2}, {start 6, audio 1}]` → entry 0 ends at 6 (caption stays up), entry 1 starts at 6.
- [ ] **Step 2:** `cd tools/demo-video && npm i -D vitest tsx typescript @types/node && npm i playwright @supabase/supabase-js dotenv && npx playwright install chromium`, then `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `timeline.ts`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(demo): scaffold demo-video tooling with timeline/SRT core`.

### Task 2: Demo data: seed, preflight, cleanup

**Files:**
- Create: `tools/demo-video/src/demo-data.ts`, `tools/demo-video/src/supabase.ts`, `tools/demo-video/src/seed.ts`, `tools/demo-video/src/cleanup.ts`, `tools/demo-video/test/preflight.test.ts`

**Interfaces:**
- `demo-data.ts` exports `SECTION = "C1"`, `DEMO_PASSWORD = "Mapp@Demo2026"` (used for accounts that skip first login and as the "new password" typed on camera), and account constants:
  - `ADVISOR` Dr. Priya Raman (emp_id `EMP90101`, `priya.raman@srmist.edu.in`, cadre valid per `src/lib/config.ts` cadre list, domains incl. "Machine Learning"), advisor of C1, first login shown on camera.
  - `GUIDE2` Dr. Karthik S (`EMP90102`, `karthik.s@srmist.edu.in`), password pre-changed.
  - `STUDENT_A` Arjun Kumar `RA2311003010901` (MOOC, first login on camera).
  - `STUDENT_B` Sneha Iyer `RA2311003010902` (Minor, pre-changed) and `PARTNER_B` Rahul Menon `RA2311003010903`.
  - `EXTRAS`: 5 students `RA231100301091x` (realistic names); 4 send `submit_request` to ADVISOR and 1 sends `opt_mooc(9.4)`.
  - `isDemoUsername(u: string): boolean`.
- `supabase.ts`: `adminClient()`, `signInAs(email: string, password: string): Promise<SupabaseClient>` (anon key, no session persistence).
- `seed.ts` exports `preflight(admin): Promise<void>` (throws `"Portal is frozen …"` if `global_frozen`, and `"Section C1 already has advisor …"` if C1 is mapped to a non-demo emp_id), and `main()`: preflight → `upsertFaculty` ×2 → `upsertAdvisor(C1→EMP90101)` → `upsertStudent` for all → set `DEMO_PASSWORD` + `must_change_password=false` (auth admin `updateUserById` + profiles) for every account except ADVISOR and STUDENT_A → extras' requests via `signInAs(...).rpc(...)` → PARTNER_B `submit_request` to GUIDE2.
- `cleanup.ts`: deletes only accounts whose username matches `isDemoUsername`, by `auth.admin.deleteUser` (cascades), and removes the C1 advisor mapping. Prints a count.

- [ ] **Step 1: Failing test** `preflight.test.ts` with a stub admin client: `global_frozen: true` → rejects `/frozen/`; C1 mapped to `EMP12345` → rejects `/C1/`; clean → resolves.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the files. Look up the `faculty_advisors` columns and cadre values from `supabase/migrations/0009_v3.sql` and `src/lib/config.ts`.
- [ ] **Step 4:** `npm test` passes, then `npm run reset` twice. Expected: both runs end with "seeded" and no errors. Check with a quick query: 8 students and 2 faculty in C1 or demo, 4 pending requests to Priya, 1 pending MOOC request.
- [ ] **Step 5:** Commit `feat(demo): demo account seed, preflight and cleanup`.

### Task 3: TTS + recorder engine

**Files:**
- Create: `tools/demo-video/src/tts.ts`, `tools/demo-video/src/recorder.ts`, `tools/demo-video/src/cursor.js` (init script), `tools/demo-video/test/recorder.test.ts`

**Interfaces:**
- `tts.ts`: `synth(text: string): Promise<{ path: string; sec: number }>`. Runs `edge-tts --voice en-IN-PrabhatNeural --text … --write-media .cache/<sha1>.mp3`, caches by text hash, and measures duration with `ffprobe -show_entries format=duration`.
- `recorder.ts`:
  - `type Step = { caption: string; narration: string; run: (page: Page) => Promise<void> }`
  - `type Segment = Step[] | { offCamera: (step?: void) => Promise<void> }`: an off-camera action executes between steps without its own visuals (the following step's narration explains it).
  - `record(name: string, segments: Segment[]): Promise<{ videoPath: string; logs: StepLog[] }>`: launches Chromium 1920×1080, `colorScheme: "light"`, `recordVideo` to `demo-output/raw/`, `addInitScript(cursor.js)`, and pre-synthesizes all narration. For each step it logs `startSec` relative to the recording start, runs `run`, waits until `startSec + audioSec + 0.4`, and asserts no error toast is visible (throws `Error toast on screen during "<caption>"`).
  - `humanType(page, selector, text)` (≈70 ms/char) and `clickWithCursor(page, locator)` (moves the overlay cursor, shows the ripple, clicks). Steps use these.
- `cursor.js`: fixed-position SVG arrow following `mousemove`, plus a ripple on `mousedown`.

- [ ] **Step 1: Failing test** `recorder.test.ts` with a local `data:` HTML page: a step whose `run` injects `<div data-sonner-toast data-type="error">` → `record` rejects `/Error toast/`. A normal 1-step run returns `logs[0].startSec >= 0` and `logs[0].audioSec > 0`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement (`pip install edge-tts` first).
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(demo): TTS cache and Playwright step recorder with cursor overlay`.

### Task 4: Assembler

**Files:**
- Create: `tools/demo-video/src/assemble.ts`, `tools/demo-video/src/card.html` (title-card template), `tools/demo-video/test/assemble.test.ts`

**Interfaces:**
- `ffmpegArgs(opts: { video: string; intro: string; outro: string; timeline: ReturnType<typeof buildTimeline>; srt: string; out: string; introSec: number }): string[]`: builds a single ffmpeg invocation. It concats intro + raw recording + outro (scaled to 1920×1080, 30 fps), mixes every narration clip with `adelay=<(startSec+introSec)*1000>`, and burns the captions with `subtitles=` (style: bottom-centre, white text on a semi-opaque dark box, `FontSize=24`). SRT times are shifted by `introSec`.
- `renderCard(title: string, subtitle: string, out: string): Promise<void>`: screenshots `card.html` in Playwright to a PNG, which becomes a 4-second clip (intro also narrated, outro silent).
- `assemble(name: "Student" | "Faculty", rec, introNarration): Promise<string>` → writes `demo-output/MAPP-<name>-Demo.mp4` + `.srt`.

- [ ] **Step 1: Failing test:** `ffmpegArgs` with 2 timeline entries contains `adelay=4000|4000` for an entry at 0 s with `introSec` 4, contains `subtitles=`, and ends with the `out` path.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. On Windows, escape the SRT path in the subtitles filter (`C\\:/…`).
- [ ] **Step 4:** `npm test` passes. Smoke test: run `assemble` on the Task 3 test recording. Expected: a playable MP4 where `ffprobe` reports 1920×1080 and an audio stream.
- [ ] **Step 5:** Commit `feat(demo): ffmpeg assembler with title cards, narration mix and burned captions`.

### Task 5: Student demo script

**Files:**
- Create: `tools/demo-video/src/student.ts`, `tools/demo-video/src/offcamera.ts`

**Interfaces:**
- `offcamera.ts`: `approveMooc(regNo)` (signs in as ADVISOR, finds the request via `fa_mooc_requests`, `respond_mooc_request(id,'approved')`; check the accepted decision value in migration 0012); `acceptAndGroup(guide, regNos: [string,string])` (as guide: `respond_request(id,'accepted')` for both, then `save_batch(1, members)` with section, advisor name, contact and mail).
- `student.ts`: `main()` → `reset` → `record("student", segments)` → `assemble("Student", …)`.

Segments, in order (each bullet is one Step. Narration is formal, 1–3 sentences, HOD audience):
- **Part 1, Student A:** open `/login` (portal guidelines visible) → Student tab, type reg no + reg no as password → forced password change: type the old password and `DEMO_PASSWORD` twice → land on the portal, sidebar explained (MOOC / Minor / Application Form) → MOOC page: rules + important note → tick agree → Submit → dialog: CGPA `9.45` → "Send to Faculty Advisor" → success dialog → close → "Awaiting Faculty Advisor approval" card → Minor nav shows the lock message → **offCamera `approveMooc`** → step "Faculty Advisor approves": reload, "Your MOOC request is approved" card → logout.
- **Part 2, Student B:** login (pre-changed password) → Minor page: faculty list, search/domain filter, open Dr. Karthik S's details → send request → confirmation → status pending → **offCamera `acceptAndGroup(GUIDE2,[B, PARTNER_B])`** → step: reload, status accepted/grouped, Application Form unlocked → fill in title, project type, SDG, problem-by-guide, mail/mobile (partner fields prefilled or typed) → save draft → submit → confirm → download the PDF (Playwright `waitForEvent("download")`, saved to `demo-output/`) → optional step showing page 1 of the PDF as an image (render it in a new tab via pdf.js from a CDN or an `<img>` from `pdftoppm` if available. If neither works easily, skip it) → closing narration.

Look up the exact labels and selectors in `src/app/student/minor/minor-client.tsx` and `src/app/student/application/application-client.tsx`. Prefer `getByRole`/`getByLabel`.

- [ ] **Step 1:** Implement `offcamera.ts` + `student.ts`.
- [ ] **Step 2:** Start the app: `npm run build && npm run start` (root, port 3000; `BASE_URL` env in the tool defaults to `http://localhost:3000`).
- [ ] **Step 3:** `npm run record:student`. Expected: `demo-output/MAPP-Student-Demo.mp4` exists, ~5–7 min.
- [ ] **Step 4:** Review: extract a frame every 20 s (`ffmpeg -vf fps=1/20`) and view them. Check for no error toasts, no spinners under narration, captions readable and the cursor visible. Fix and re-record until clean.
- [ ] **Step 5:** Commit `feat(demo): student demo script`.

### Task 6: Faculty demo script

**Files:**
- Create: `tools/demo-video/src/faculty.ts`

Segments: `/login` → Faculty tab, `priya.raman@srmist.edu.in` + `EMP90101` → forced password change → portal overview (sidebar: Students Approached, Batch Grouping, Faculty Advisor; seat counters) → Students Approached: 4 pending requests, open one, accept 2 (the extras), decline 1 explained but not done (narrate only) → Batch Grouping: create Batch 1 with the 2 accepted students (fill in section/advisor/contact/mail), save, show the batch card → Faculty Advisor page: Section C1, MOOC reviews table, extra student's request with CGPA 9.40 → Approve → status approved (Student A, already approved in the student run, shows too if the run order is student → faculty, which is fine) → Class overview: counts + filter by status → closing narration → logout.

Run `reset` at the start only if the student video is not recorded in the same session. Default: `faculty.ts` calls `reset` itself, then re-applies Student A's MOOC request so the overview shows a realistic mix.

- [ ] **Step 1:** Implement, reading the labels in `src/app/faculty/approached/approached-client.tsx`, `src/app/faculty/batches/batch-form.tsx`, `src/app/faculty/advisor/mooc-reviews.tsx` and `src/components/class-overview.tsx`.
- [ ] **Step 2:** `npm run record:faculty`. Expected: `demo-output/MAPP-Faculty-Demo.mp4`, ~4–6 min.
- [ ] **Step 3:** Frame review as in Task 5 Step 4. Fix until clean.
- [ ] **Step 4:** Commit `feat(demo): faculty demo script`.

### Task 7: README + handoff

**Files:**
- Create: `tools/demo-video/README.md` (prereqs: ffmpeg, Python + edge-tts, `npx playwright install chromium`. Commands: `reset`, `record:student`, `record:faculty`, `cleanup`. Note that it writes to the Supabase project in `.env`.)

- [ ] **Step 1:** Write the README.
- [ ] **Step 2:** Run `npm test` in `tools/demo-video`. Expected: all pass. Root `npm run typecheck && npm run lint` remain clean (the tool folder is excluded if needed via `tsconfig`/eslint ignores).
- [ ] **Step 3:** Commit `docs(demo): how to re-record the demo videos`. Report both MP4 paths to the user. Do NOT run `cleanup`. Ask the user.
