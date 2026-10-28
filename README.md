# MAPP – Minor and Major Project Allocation Portal

Next.js 16 (App Router, TypeScript, Tailwind) + Supabase (Postgres, Auth, RLS, Realtime, RPC). No separate server.

## Setup

1. **Create a Supabase project**, then copy `.env.example` to `.env` and fill in the URL, anon key, service-role key and `ADMIN_INITIAL_PASSWORD` (12+ characters).
2. **Run migrations** in order, in the Supabase SQL editor (or `supabase db push` with the CLI):
   `0001_schema.sql`, `0002_rpc.sql`, `0003_rls_realtime.sql`, `0004_hardening.sql`. **Login will not work until `0004` is applied** (it creates the brute-force throttle).
3. **Create the admin**: `npm install && npm run seed:admin` (username `mappCtech`). Sign in, set a new password, then delete `ADMIN_INITIAL_PASSWORD` from the environment.
4. **Load data**: sign in as admin -> **Import data**, upload the student and faculty CSVs (templates are downloadable on that page), then **download the credentials sheet**. Every new account gets a random one-time password (shown once, never stored); hand each person their own login privately. Everyone must choose a new password at first sign-in. Lost sheet? Use **Reset password** in the admin portal to issue a new one.
5. `npm run dev` -> http://localhost:3000

**Supabase dashboard settings (required before going live):**
- Authentication -> Providers -> Email -> turn **OFF "Allow new users to sign up"** (accounts are created only by the admin import / seed script). Leave "Confirm email" as is; imported users are pre-confirmed.
- Authentication -> Sessions: set a **time-box / inactivity timeout** and a sensible JWT expiry (e.g. 1 hour) if your plan allows.
- Authentication -> Attack Protection: enable CAPTCHA (hCaptcha/Turnstile) only if you also add it to the login form; otherwise rely on the app throttle below.
- Project Settings -> API: keep the service-role key out of anything but Vercel's server-side env vars.

## Scripts

| | |
|---|---|
| `npm run dev / build / start` | Next.js |
| `npm run lint`, `npm run typecheck` | static checks |
| `npm test` | Vitest: unit tests + DB tests |
| `npm run seed:admin` | create the admin account (one-off) |

The DB tests boot a throw-away real Postgres (`embedded-postgres`, no Docker), stub the Supabase `auth` schema, apply every migration, and test: one student = one request, accepting beyond capacity fails (incl. a concurrent race), decline unlocks Minor, MOOC ⇄ Minor exclusivity, cadre → seats/batches, batch rules, login throttle, RLS/privilege checks.

## Deploy (Vercel)

Import the repo, set the three Supabase env vars (service-role key as a server-only secret), apply all four migrations to the production project, then deploy. `ADMIN_INITIAL_PASSWORD` is only needed on the machine where you run `npm run seed:admin`, not on Vercel.

## Security notes

- **Authentication**: Supabase Auth (email + password; usernames are mapped to emails server-side in `/api/auth/login`). No sign-ups, no password reset by email, no social login: the admin issues one-time passwords.
- **One-time passwords**: random 12-character CSPRNG passwords (about 68 bits), never derived from registration number or date of birth. Forced change at first login; the policy requires 10+ characters with a letter and a number, and rejects a password containing the username.
- **Brute-force protection** (`auth_throttle`, service-role only): 5 failures per account+IP, 30 per account across all IPs, 300 per IP, each per 15 minutes, then a 15-minute lock. Counters are scoped so one student cannot lock out another. If the throttle store is unreachable, sign-in fails closed (503). Supabase's own per-IP limits apply on top.
- **Authorization**: the browser can only `SELECT` (RLS default-deny, explicit `REVOKE` of writes); all writes are `SECURITY DEFINER` RPCs that verify `auth.uid()` + role, or service-role route handlers that re-verify an admin session server-side. EXECUTE on internal helpers is revoked from `anon`/`authenticated`. Users flagged `must_change_password` are refused everywhere (proxy, layouts and database).
- **Secrets**: the service-role key is server-only (`server-only` import guard). Faculty date of birth is no longer collected or stored.
- **Route handlers** enforce same-origin (Origin / Sec-Fetch-Site) checks, body-size limits and zod validation; error responses never echo database or auth internals. Import rejects usernames that would take over an existing account of another role, and reserved email domains.
- **Passwords**: changing a password verifies the current one (throttled), signs out all other sessions, and clears the first-login flag server-side. An admin reset flags the account first, then sets a fresh random password.
- **Headers**: CSP (connections limited to this site and the project's own Supabase origin), HSTS, `X-Frame-Options: DENY`, `nosniff`, COOP/CORP, `noindex`. `script-src` keeps `'unsafe-inline'` because Next.js needs inline bootstrap scripts without per-request nonces; no user content is ever rendered as HTML.
- Excel/CSV cells starting with `= + - @` are neutralised on export and in downloaded CSVs (formula-injection guard).

## Architecture notes

- **All invariants live in Postgres**: partial unique index `requests(student_id, project_type) WHERE status IN ('pending','accepted')`; `respond_request` locks the request and faculty rows; seats are derived from cadre by trigger; `batch_members.student_id` is unique and a trigger requires an accepted request with the batch's faculty.
- **RLS is default-deny; clients can only SELECT.** All writes go through `SECURITY DEFINER` RPCs (role checked inside) or service-role route handlers. Students never read `faculty` directly (they use `list_faculty` / `get_faculty` / `my_minor_status`).
- Users with `must_change_password = true` are blocked by the proxy (`src/proxy.ts`; Next 16's name for middleware), by the portal layouts, **and** by the database (`app_role()` returns null and RPCs refuse), so the modal can't be bypassed by calling the API.
- Login maps username -> email on the server (`/api/auth/login`). Students: `<regno>@students.mapp.local`; admin: `admin@mapp.local`; faculty: their SRM mail.
- Excel cells starting with `= + - @` are prefixed with `'` (formula-injection guard). Imports validate every row with zod server-side and report row-level errors.
- Editable constants (rules text, page size, popup texts): `src/lib/config.ts`.

## Assumptions

1. Initial passwords are random one-time values issued by the admin (import credentials sheet / Reset password).
2. Opting for MOOC is final for the student; the admin can undo it ("Undo MOOC"). An active Minor request blocks MOOC.
3. Pending requests don't reserve seats; seats are consumed on Accept.
4. Seats follow the MAPP spec (HOD 6 / Assoc. Chair 4 / others 8).
5. Domain filter matches any of a faculty's domains.
6. `project_type` (`minor`|`major`) exists on `requests`, `batches`, `batch_members`; the one-active-request index is per project type.
7. AI domain chatbot is out of scope.
8. **Live updates**: a student's own request status updates via Realtime. Students can't read `faculty` (RLS), so the faculty list refreshes by 20 s polling (visible tabs only) and on window focus rather than Realtime. Faculty/admin get Realtime seat updates.
9. Admin "remove allocation" marks the request `declined` (freeing the seat and unlocking the student).
10. Batch contact must be 10–13 digits; SRM mail must be a valid email (not restricted to one domain).
11. Imports run in 50-row chunks from the browser so they fit serverless time limits.
12. Declining only applies to pending requests; later removal is an admin action.
