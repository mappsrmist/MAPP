# MAPP – Minor and Major Project Allocation Portal

Next.js 16 (App Router, TypeScript, Tailwind) + Supabase (Postgres, Auth, RLS, Realtime, RPC). No separate server.

## Setup

1. **Create a Supabase project**, then copy `.env.example` to `.env` and fill in the URL, anon key, service-role key and `ADMIN_INITIAL_PASSWORD` (12+ characters).
2. **Run migrations** in order, in the Supabase SQL editor (or `supabase db push` with the CLI):
   `0001_schema.sql`, `0002_rpc.sql`, `0003_rls_realtime.sql`, `0004_hardening.sql`, `0005_v2.sql`. **Login will not work until `0004` is applied** (it creates the brute-force throttle); the v2 portal needs `0005`. `0006_drop_legacy_batch_columns.sql` is a follow-up: apply it only after v2 is deployed and the batch sheets look right (see CHANGELOG.md).
3. **Create the admin**: `npm install && npm run seed:admin` (username `mappCtech`). Sign in, set a new password, then delete `ADMIN_INITIAL_PASSWORD` from the environment.
4. **Load data**: sign in as admin -> **Import data**, upload the student and faculty Excel workbooks (templates are downloadable on that page), New accounts start with an initial password: students use their **registration number** (username and password), faculty use their **SRM email** as username and their **employee ID** as password. Everyone must choose a new password at first sign-in. Forgotten password? Use **Reset password** in the admin portal to put the initial password back.
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
| `npm run security:client-secrets` | scan `.next/static` for configured private credential values after a successful build |

The DB tests boot a throw-away real Postgres (`embedded-postgres`, no Docker), stub the Supabase `auth` schema, apply every migration, and test: one student = one request, accepting beyond capacity fails (incl. a concurrent race), decline unlocks Minor, MOOC ⇄ Minor exclusivity, cadre → seats/batches, batch rules, login throttle, RLS/privilege checks, and the v2 features (multi-domain list, application-form gate, group/ungroup, freeze, audit log, admin allocation actions). If the default test ports are busy, set `MAPP_TEST_PG_PORT` / `MAPP_TEST_PG_PORT_V2`.

## Deploy (Vercel)

Import the repo, set the three Supabase env vars (service-role key as a server-only secret), apply migrations `0001`–`0005` to the production project (before deploying the v2 code, since the new pages call the new RPCs), then deploy. `ADMIN_INITIAL_PASSWORD` is only needed on the machine where you run `npm run seed:admin`, not on Vercel.

## Security notes

**Apply `0007_security_limits.sql` before deploying the hardened API routes.** Missing limiter functions intentionally make requests fail closed (503). Apply migrations in order through `0007` on a backup/staging database first. This source change does not apply any production migrations or provider settings.

Admin data imports, templates and error reports use **Excel `.xlsx` only** (5 MiB, 5,000 data rows). The sheet does not have to follow the template: the importer picks the best-matching worksheet, finds the header row within the first 30 rows, matches columns by title (e.g. "Register Number", "Name of the Student", "E-Mail ID", "Employee ID", "Area of Interest"), ignores extra columns, and reads formula results, hyperlink text and merged cells. The admin reviews the column matching and a preview before importing, and can set a value for every row when a column is missing (Dept, Cadre). Cadre is read from a Cadre or Designation column ("Professor & Head" → HOD) and defaults to OTHER; designation itself is not stored. Faculty Advisors are matched by Emp ID only (the SRM email comes from the faculty record). Workbooks with macros, password protection, XML entities or oversized ZIP expansion (over 60 MiB) are rejected before parsing. The server independently restricts requests to 512 KiB, 100 rows, known columns and bounded string cells. Error reports give the row number in the uploaded sheet.

Shared request budgets count successful as well as unsuccessful application API calls: login 30/account and 5,000/IP per 15 minutes (to accommodate campus onboarding); password change 10/user/minute; admin import 120/admin/minute; reset 20/admin/minute. The existing failure-based login locks apply too. Business RPCs independently consume a combined 120/user/minute database budget, including direct Supabase calls. Exposed read RPCs use POST because consuming a budget writes to the database. Limiter/store failures return generic errors without database details.

**Coverage limits:** failed RPC transactions roll back their counters; direct table reads, Supabase Auth and Realtime need provider/gateway abuse controls. The current code does not provide universal per-user throttling for those surfaces. Retaining identifier-based initial/reset passwords is the explicitly requested college policy and leaves accounts vulnerable to a correct first guess until the legitimate owner changes the password. Faculty employee IDs are normal displayed project data, so they must not be treated as secrets.

There is no PDF upload, storage bucket or AI endpoint in this checkout. PDFs are generated for download. Consequently no PDF malware scanning or prompt-injection filter is claimed. A future upload feature requires server-side file verification, private storage, ownership policies and malware quarantine before downloads are permitted.

Before release, verify the deployed Supabase configuration against the [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod): disable public signup, configure Auth rate limits and password policy, protect dashboard/admin access with MFA, and verify session expiration. Restrict Vercel environment access and rotate any previously exposed secret. The Supabase anon/publishable key is intentionally public and must be protected by RLS; service-role and other private API keys must stay server-only. Vercel deployments use the [platform-forwarded IP header](https://vercel.com/docs/headers/request-headers); other reverse proxies must overwrite client-supplied forwarding headers.

- **Authentication**: Supabase Auth (email + password; usernames are mapped to emails server-side in `/api/auth/login`). No sign-ups, no password reset by email, no social login: the admin resets passwords.
- **Initial passwords**: registration number (students) / employee ID (faculty). These are guessable by anyone who knows them, so the account is locked to the change-password screen until the user sets a new one (10+ characters with a letter and a number, not containing the username), and the login throttle limits guessing. Accounts that have not yet signed in are the exposed ones: ask everyone to sign in and change it promptly, and keep the allocation window closed until then if possible.
- **Brute-force protection** (`auth_throttle`, service-role only): 5 failures per account+IP, 30 per account across all IPs, 300 per IP, each per 15 minutes, then a 15-minute lock. Counters are scoped so one student cannot lock out another. If the throttle store is unreachable, sign-in fails closed (503). Supabase's own per-IP limits apply on top.
- **Authorization**: the browser can only `SELECT` (RLS default-deny, explicit `REVOKE` of writes); all writes are `SECURITY DEFINER` RPCs that verify `auth.uid()` + role, or service-role route handlers that re-verify an admin session server-side. EXECUTE on internal helpers is revoked from `anon`/`authenticated`. Users flagged `must_change_password` are refused everywhere (proxy, layouts and database).
- **Secrets**: the service-role key is server-only (`server-only` import guard). Faculty date of birth is no longer collected or stored.
- **Route handlers** enforce same-origin (Origin / Sec-Fetch-Site) checks, body-size limits and zod validation; error responses never echo database or auth internals. Import rejects usernames that would take over an existing account of another role, and reserved email domains.
- **Passwords**: changing a password verifies the current one (throttled), signs out all other sessions, and clears the first-login flag server-side. An admin reset flags the account first, then restores the initial password.
- **Headers**: CSP (connections limited to this site and the project's own Supabase origin), HSTS, `X-Frame-Options: DENY`, `nosniff`, COOP/CORP, `noindex`. `script-src` keeps `'unsafe-inline'` because Next.js needs inline bootstrap scripts without per-request nonces; no user content is ever rendered as HTML.
- Excel cells starting with `= + - @` are neutralised on export and in downloaded workbooks (formula-injection guard).

### Security verification limits

The application throttle protects the Next.js sign-in route. Supabase Auth is also directly
reachable using the public project URL and anon key, so Supabase's own rate limits and attack
protection remain necessary; the application throttle alone does not protect that endpoint.
Forwarded IP headers are trustworthy only when the hosting proxy replaces client-supplied values.
The origin check compares the complete request origin, including scheme and port; a reverse proxy
must preserve the public request URL correctly.

API JSON bodies are limited to 512 KiB while streaming, even without a Content-Length header.
The security regression tests cover the actual size limit, origin validation, and shared admin
throttle keys. Database tests cover role policies, RPC permissions and allocation rules.
Passing tests or a clean dependency audit does not certify an application as vulnerability-free.
Production Supabase settings, applied migrations, HTTPS, session expiry and secret management
must also be verified in the deployed environment. The current CSP still allows inline scripts,
as described above; a nonce-based CSP would provide additional protection.

## Architecture notes

- **All invariants live in Postgres**: partial unique index `requests(student_id, project_type) WHERE status IN ('pending','accepted')`; `respond_request` locks the request and faculty rows; seats are derived from cadre by trigger; `batch_members.student_id` is unique and a trigger requires an accepted request with the batch's faculty.
- **RLS is default-deny; clients can only SELECT.** All writes go through `SECURITY DEFINER` RPCs (role checked inside) or service-role route handlers. Students never read `faculty` directly (they use `list_faculty` / `get_faculty` / `my_minor_status`).
- Users with `must_change_password = true` are blocked by the proxy (`src/proxy.ts`; Next 16's name for middleware), by the portal layouts, **and** by the database (`app_role()` returns null and RPCs refuse), so the modal can't be bypassed by calling the API.
- Login maps username -> email on the server (`/api/auth/login`). Students: `<regno>@students.mapp.local`; admin: `admin@mapp.local`; faculty: their SRM mail.
- Excel cells starting with `= + - @` are prefixed with `'` (formula-injection guard). Imports validate every row with zod server-side and report row-level errors.
- Editable constants (rules text, page size, popup texts): `src/lib/config.ts`.

## Assumptions

1. Initial passwords are the registration number / employee ID (see above); the forced first-login change is the only protection until the user signs in.
2. Opting for MOOC is final for the student; the admin can undo it ("Undo MOOC"). An active Minor request blocks MOOC.
3. Pending requests don't reserve seats; seats are consumed on Accept.
4. Seats follow the MAPP spec (HOD 4 / Assoc. Chair 4 / others 8).
5. Domain filter matches any of a faculty's domains.
6. `project_type` (`minor`|`major`) exists on `requests`, `batches`, `batch_members`; the one-active-request index is per project type.
7. AI domain chatbot is out of scope.
8. **Live updates**: a student's own request status updates via Realtime. Students can't read `faculty` (RLS), so the faculty list refreshes by 20 s polling (visible tabs only) and on window focus rather than Realtime. Faculty/admin get Realtime seat updates.
9. Admin "remove allocation" marks the request `declined` (freeing the seat and unlocking the student).
10. Batch contact must be 10–13 digits; SRM mail must be a valid email (not restricted to one domain).
11. Imports run in 50-row chunks from the browser so they fit serverless time limits.
12. Declining only applies to pending requests; later removal is an admin action.
