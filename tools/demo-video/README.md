# MAPP demo videos

Records the two narrated demo videos of the real portal:

- `demo-output/MAPP-Student-Demo.mp4`: Arjun's first login and MOOC request (approved by the Faculty Advisor off camera), then Sneha's Minor request, batch, Application Form and PDF.
- `demo-output/MAPP-Faculty-Demo.mp4`: Dr. Priya Raman (guide and Faculty Advisor of section C1): first login, accepting students, batch grouping, MOOC approval, class overview.

**This writes to the Supabase project in the repo's `.env`.** It creates 8 demo students, 2 demo faculty and the C1 advisor mapping. It never touches other accounts or the freeze setting, and it refuses to run while the portal is frozen.

## Prerequisites

- ffmpeg and ffprobe on PATH
- Python with `pip install edge-tts pymupdf` (voice `en-IN-PrabhatNeural`, PDF preview)
- `npm install && npx playwright install chromium` in this folder

## Record

```bash
# 1. in the repo root: a production build of the app on port 3210
npm run build && npx next start -p 3210

# 2. in tools/demo-video (each run resets the demo data first)
npm run record:student
npm run record:faculty
```

Use `BASE_URL=http://localhost:<port>` to point at another server. Narration clips are cached in `.cache/`. Edit the `narration` / `caption` text in `src/student.ts` or `src/faculty.ts` and re-run to change what is said. A failed run saves `demo-output/raw/<name>-failure.png`, and an error toast on screen fails the run deliberately.

## Clean up

```bash
npm run cleanup   # deletes only the demo accounts listed in src/demo-data.ts (and their requests, batches, C1 mapping)
```

`npm run reset` = cleanup + seed, if you want the demo accounts in place to click around manually. The demo password is in `src/demo-data.ts`.

## Tests

`npm test`: timeline/SRT, preflight, TTS + recorder, assembler arguments, and sync-marker detection.
