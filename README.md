# MAPP – Minor and Major Project Allocation Portal

Next.js 16 (App Router, TypeScript, Tailwind) + Supabase (Postgres, Auth, RLS, Realtime, RPC). No separate server.

## Setup

1. **Create a Supabase project**, then copy `.env.example` to `.env.local` and fill in the URL, anon key, service-role key and `ADMIN_INITIAL_PASSWORD`.
2. **Run migrations** in order, in the Supabase SQL editor (or `supabase db push` with the CLI):
   `supabase/migrations/0001_schema.sql`, `0002_rpc.sql`, `0003_rls_realtime.sql`.
3. **Create the admin**: `npm install && npm run seed:admin` (username `mappCtech`, password from `ADMIN_INITIAL_PASSWORD`).
4. **Load data** – either
   - demo data: run `supabase/seed.sql` in the SQL editor (1 HOD, 1 Associate Chair, 3 faculty, 30 students), or
   - real data: sign in as admin → **Import data** and upload the CSVs (templates are downloadable on that page).
5. `npm run dev` → http://localhost:3000

Demo logins: students `RA24110030100NN` (NN = 01–30) with the same value as password; faculty e.g. `ramesh.k@srmist.edu.in` with password `14031972` (DOB `DDMMYYYY`). Everyone must change their password on first login.

**Supabase dashboard settings (do these):** Authentication → Providers → Email → **turn OFF "Allow new users to sign up"** (accounts are created only by the admin import / seed scripts); keep Auth rate limits at their defaults (they throttle login attempts; the login handler returns one generic error for every failure and a specific message on HTTP 429).

## Frontend-only testing (mock mode)

With no Supabase project yet, set `NEXT_PUBLIC_MOCK=1` in `.env.local` and run `npm run dev`. An in-memory fake backend is used (dev only; ignored by production builds; resets on restart). Logins (username = password): student `RA2400000000001`, faculty `test.faculty@srmist.edu.in`, admin `mappCtech`. Remove the flag to use the real backend. Code: `src/lib/mock/`.

## Scripts

| | |
|---|---|
| `npm run dev / build / start` | Next.js |
| `npm run lint`, `npm run typecheck` | static checks |
| `npm test` | Vitest: unit tests + DB tests |
| `npm run seed:admin` | create the admin account |

The DB tests boot a throw-away real Postgres (`embedded-postgres`, no Docker), stub the Supabase `auth` schema, apply every migration and `seed.sql`, and test: one student = one request, accepting beyond capacity fails (incl. a concurrent race), decline unlocks Minor, MOOC ⇄ Minor exclusivity, cadre → seats/batches, batch rules, RLS/privilege checks.

## Deploy (Vercel)

Import the repo, set the four env vars (service-role key and admin password as server-only secrets), deploy. Run migrations/seed against the production Supabase project first.

## Security notes

- Browser can only `SELECT` (RLS default-deny, explicit `REVOKE` of writes); all writes are `SECURITY DEFINER` RPCs that verify `auth.uid()` + role, or service-role route handlers that re-verify an admin session server-side. EXECUTE on internal helper functions is revoked from `anon`/`authenticated` (Supabase grants it by default).
- Service-role key and admin password are server-only (`server-only` import guard); never sent to the client. Faculty `dob` (the initial password) is never selected by client queries.
- Route handlers enforce same-origin (CSRF), body-size limits and zod validation; security headers + CSP are set in `next.config.ts`.
- Changing a password verifies the current one, signs out all other sessions, and clears the first-login flag server-side. An admin password reset forces a change at next login (the database refuses everything for flagged users).
- The initial passwords (reg no / DOB) are weak by design (spec): users must change them on first login, so import data shortly before rollout.
- Login attempts are throttled by Supabase Auth, not by this app.

## Architecture notes

- **All invariants live in Postgres**: partial unique index `requests(student_id, project_type) WHERE status IN ('pending','accepted')`; `respond_request` locks the request and faculty rows; seats are derived from cadre by trigger; `batch_members.student_id` is unique and a trigger requires an accepted request with the batch's faculty.
- **RLS is default-deny; clients can only SELECT.** All writes go through `SECURITY DEFINER` RPCs (role checked inside) or service-role route handlers. Students never read `faculty` directly (they use `list_faculty` / `get_faculty` / `my_minor_status`).
- Users with `must_change_password = true` are blocked by the proxy (`src/proxy.ts`; Next 16's name for middleware), by the portal layouts, **and** by the database (`app_role()` returns null and RPCs refuse), so the modal can't be bypassed by calling the API.
- Login maps username → email on the server (`/api/auth/login`). Students: `<regno>@students.mapp.local`; admin: `admin@mapp.local`; faculty: their SRM mail.
- Excel cells starting with `= + - @` are prefixed with `'` (formula-injection guard). Imports validate every row with zod server-side and report row-level errors.
- Editable constants (rules text, DOB password format, page size, popup texts): `src/lib/config.ts`.

## Assumptions

1. Faculty default password = DOB as `DDMMYYYY` (`DOB_PASSWORD_FORMAT`). The DOB is stored on the faculty row so the admin can reset passwords.
2. Opting for MOOC is final for the student; the admin can undo it ("Undo MOOC"). An active Minor request blocks MOOC.
3. Pending requests don't reserve seats; seats are consumed on Accept.
4. Seats follow the MAPP spec (HOD 6 / Assoc. Chair 4 / others 8).
5. Domain filter matches any of a faculty's domains.
6. `project_type` (`minor`|`major`) exists on `requests`, `batches`, `batch_members`; the one-active-request index is per project type.
7. AI domain chatbot is out of scope.
8. **Live updates**: a student's own request status updates via Realtime. Students can't read `faculty` (RLS), so the faculty list refreshes by 10 s polling and on window focus rather than Realtime. Faculty/admin get Realtime seat updates.
9. Admin "remove allocation" marks the request `declined` (freeing the seat and unlocking the student).
10. Batch contact must be 10–13 digits; SRM mail must be a valid email (not restricted to one domain).
11. Imports run in 50-row chunks from the browser so they fit serverless time limits.
12. Declining only applies to pending requests; later removal is an admin action.
