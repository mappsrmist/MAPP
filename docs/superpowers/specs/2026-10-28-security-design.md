# Security checkup and hardening design

Status: source hardening implemented; production configuration and deployment remain to be verified. Findings below describe the initial audit.

## Intent

Protect student, faculty and administrator accounts, credentials and project data. Enforce authorization at the database as well as in the UI. This work reduces concrete risks; it cannot certify the application as impenetrable.

## Current findings

- Authentication uses Supabase Auth and server-side `getUser` verification. Portal layouts, proxy and database RPCs enforce roles. Client writes to application tables are revoked and RLS limits reads.
- Service-role credentials are confined to a `server-only` module and the local admin seed script. Only `.env.example` is tracked. This source inspection does not establish that credentials were never leaked in git history, logs, deployed bundles or provider settings.
- Registration numbers and employee IDs are used as initial and reset passwords. Anyone knowing an identifier can claim an unactivated account; requiring a subsequent password change does not prove identity.
- Login throttling checks and records failures separately, allowing concurrent attempts before failures are recorded. Successful requests do not consume a request budget. Throttle write errors are not checked.
- Admin import/reset routes lack rate limits. Database RPCs are called directly from browsers, so application-only limits would be bypassable.
- JSON streams have a real 512 KiB cap, but schemas strip unexpected keys rather than rejecting them; import row records accept arbitrary keys and nested values before per-row validation.
- The Excel file picker has no byte or row cap and does not reject all parse errors. The server receives bounded JSON chunks, not the original file.
- There is no PDF upload endpoint, object storage integration or AI prompt processing in this checkout. PDFs are generated locally for download. Do not invent a new upload product flow during this hardening task.
- HSTS and other security headers are present. Production HTTPS and Supabase configuration have not been inspected. CSP permits inline scripts.

## Implementation decisions

1. Keep Supabase Auth and database RLS. Add adversarial tests for student/faculty/admin cross-role calls, ownership, anonymous access, helper privileges and role mutation. Do not trust client-supplied roles or metadata.
2. The user explicitly requires registration number as student username/initial password and faculty email as username with employee ID as initial password. Retain that policy and the existing forced first-login password change. Do not introduce random credentials or bulk credential distribution. This is an accepted residual risk: anyone who knows an ID can claim an unused/reset account. Rate limiting cannot prevent a correct first guess; IDs are also displayed as normal project data.
3. Add atomic database-backed request budgets for all four Next.js APIs, including successful calls. Scope authenticated budgets to verified user IDs and login budgets to normalized accounts and trusted deployment IP information. Fail closed on limiter errors with generic 503 responses; return 429 with Retry-After for exhausted budgets. Choose conservative configurable limits that accommodate 50-row import chunks and campus NAT.
4. Enforce a shared 120-per-minute budget inside the verified-role helper called by business RPCs. Mark exposed read RPCs VOLATILE because they now write counters; Supabase JS invokes them using POST. This covers committed RPC calls even when Next.js is bypassed. PostgreSQL rolls back counters on failed RPC transactions, so invalid calls, direct table reads, Realtime and Auth require provider/gateway limits. No pre-request write hook is installed: PostgREST GET requests use read-only transactions. This is a documented coverage limit, not a claim of universal request throttling.
5. Reject unexpected JSON properties, nested import values, excessive key/field lengths, invalid UTF-8, and dangerous control characters. Preserve passwords exactly. Normalize plain-text fields before storing them, use bound query parameters, and retain React text escaping and spreadsheet formula protection. Do not use SQL keyword blacklists or pretend that text sanitization establishes AI instruction isolation.
6. Restrict the existing picker to Excel .xlsx, 2 MiB and 5,000 rows. Bound actual ZIP expansion to 20 MiB; reject encrypted/unsupported archives, macros, embedded objects, external-link parts, XML entities, merged cells and formulas before ExcelJS parsing. Check row references before parsing, all populated cells after parsing, one worksheet and expected headers. Export templates and error reports as .xlsx and remove the unused delimited-text parser dependency. Treat browser checks as usability/resource protection; enforce bounded schemas and body sizes at the server independently. No upload endpoint accepts PDFs or arbitrary binary files.
7. Validate production Supabase URLs use HTTPS, retain HSTS/no-store/security headers, use Secure cookies in production, prevent private keys being configured with public environment names, and provide a browser-bundle scanner that never prints credential values. Retain the existing CSP: nonce-based CSP remains future work requiring dynamic-rendering compatibility verification.
8. Provide deployment steps for disabling public signup, password policy, provider-side Auth limits, administrator MFA, session lifetime, Vercel environment access and secret rotation if exposure is found. These require deployed-provider access and cannot be certified locally. Supabase anon/publishable keys are public identifiers by design; service-role, secret and AI keys must never be public.

## Verification

Use isolated local tests and disposable PostgreSQL only. Test malformed/oversized JSON, unexpected fields, stored script strings rendered as text, injection-shaped query values, parallel budget exhaustion, limiter outage, cross-role calls and direct database bypass attempts. Run typecheck, lint, tests and production build. Dependency advisory scanning requires registry connectivity and transmits dependency metadata; it is currently blocked by automatic approval review, pending explicit user permission. No attacks against third-party or production infrastructure are authorized or needed.

## Delivery and limits

Deliver code, migration, regression tests, security findings and deployment instructions. Do not automatically apply migrations to an unidentified production database. Report separately what was tested locally, what requires deployment configuration, and what remains unverified. A future PDF upload feature needs a private bucket, server-enforced size/type/signature limits, structural validation, rejection or disarming of active content, malware scanning/quarantine, owner-based access and download controls; it is outside this checkout's current feature surface.
