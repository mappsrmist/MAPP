# Changelog

## v2.1: initial passwords

- Students' initial password is their **registration number**; faculty sign in with their **SRM email** and their **employee ID** as the password. This replaces the random one-time passwords (so the credentials CSV and the one-time-password dialog are gone). Accounts still start with `must_change_password`, so the first login goes straight to the change-password screen; the throttle, CSRF and session protections are unchanged.
- **Reset password** now restores that initial password (and re-flags the account).
- Faculty `emp_id` must be at least 6 characters in the import (it is the initial password, and Supabase rejects shorter ones). Students type the registration number exactly as imported (upper case).
- Trade-off: until a user has signed in and changed it, anyone who knows a registration number or employee ID can sign in as them. Existing accounts keep their current random passwords until reset.

## v2

Upgrade order: apply `supabase/migrations/0005_v2.sql` **before** deploying the v2 code. It is additive and safe on a database that already has v1 data (existing batches are backfilled onto both members). After v2 is live and the batch sheets look right, apply `0006_drop_legacy_batch_columns.sql`.

### Student portal
- **A1 MOOC → Minor lock:** verified and covered by tests. `list_faculty`, `list_domains`, `get_faculty`, `submit_request` and `get_application` all reject a MOOC student server-side (pop-up text unchanged); a Minor request still blocks MOOC.
- **A2 Minor table:** columns `Emp ID | Name | Domain | Designation | Available Seats`. Seats show as `available/total`; all domains are comma-separated. The domain filter matches **any** of a faculty's domains, case-insensitively; the dropdown lists distinct, case-normalised domains. Search, filter and 10/page work together.
- **A3 Status card:** Emp ID, Name, Designation, Domain, Available Seats, Status, plus a boxed Phone and Venue and the meet/call message. It updates live (Realtime on the student's request, 20 s poll for the seat count while the tab is visible). A declined request unlocks Minor as before.
- **A4 Application Form** (sidebar: MOOC, Minor, Application Form): opens only after a guide accepts the request. Everyone else gets *"The Application Form opens only after your guide accepts your request."* and no form, including by direct URL, and the RPCs refuse too. Fields in the requested order, SDG suggestions (the 17 goals) with a 1–17 prefix check, prefill rules (Student 1 = you, guide fields read-only and taken from the database, Student 2 = batch partner read-only, otherwise manual and validated), Save draft / Submit, one application per team, and a PDF download (`pdf-lib`) that also works for submitted forms.

### Faculty portal
- **B1 Students Approached:** `Reg No | Name | Section | Status | Accept | Decline` (Dept removed, `—` when the section is missing). `section` is now **required** in the student import template.
- **B2 Batch counter:** the dashboard card shows Total / Formed / Remaining. Remaining drops on Group and rises on Ungroup, when an admin removes or moves an accepted student, and when a batch is cleared. It is live (Realtime on `batches` / `batch_members`).
- **B3 Group / Edit / Ungroup:** each batch card shows a Grouped / Empty badge. *Edit* changes members and details without ungrouping; *Ungroup* (with confirmation) clears the batch, returns both students to the dropdown pool and leaves their accepted status and seats alone. `ungroup_batch(batch_id)` is new and `save_batch` takes the per-student array.
- **B4 Per-student entries:** every student in a batch has their own Section, Faculty Advisor Name, SRM Mail ID and Contact Number, prefilled from the faculty profile and editable. They live on `batch_members`; v1 batch data was copied onto both members.
- **B5 Excel:** title row `Guide: <name> — Emp ID: <id> — Cadre: <cadre>`, then `Batch No. | Name | Registration No. | Section | Faculty Advisor Name | Phone No. | SRM Mail ID | Guide Name`, two rows per batch, merged Batch No. with the pastel fills, each student's own values. File name `MAPP_<FacultyName>_Batches.xlsx`; formula-injection escaping kept. The dashboard preview uses the same layout.

### Admin portal
- **C1 Freeze:** *Settings & Freeze* page (global toggle with confirmation) and a per-faculty Freeze button on the Overview faculty table. Frozen means students cannot request, opt for MOOC or edit applications, and faculty cannot accept, decline, group, ungroup or edit. It is enforced inside every write RPC (`_assert_open`), shown as a banner on every portal, and disables the buttons with tooltips. Reads and downloads still work. Every freeze/unfreeze and every admin allocation action is written to `audit_log` (who, when, scope, readable details), which the Settings page lists.
- **C2 Allocations page:** `Faculty | Batch | Reg No | Student | Section | Status | Action`, status Pending / Accepted / Declined / Grouped, filters by faculty / status / section, search by reg no or name, 10/page. Actions (admin only, allowed while frozen, audited): Edit section, Move to another faculty (seat limits respected), Remove from faculty (frees the seat, unlocks the student), Reset status to Pending. Downloads: the table, and **All allocations** in the B5 template (a combined sheet plus one sheet per faculty).

### Database / security
- New: `system_settings`, `audit_log`, `applications`, `faculty.frozen`, per-member columns on `batch_members`, `request_details_v` (adds section, per-student fields, cadre, `display_status`), RPCs `ungroup_batch`, `get_application`, `save_application`, `admin_set_global_freeze`, `admin_set_faculty_freeze`, `admin_set_section`, `admin_move_student`, `admin_reset_request`, `admin_set_application_status`. Updated: `list_faculty`, `list_domains`, `my_minor_status`, `opt_mooc`, `submit_request`, `respond_request`, `save_batch`, `clear_batch`, `admin_remove_accepted`.
- RLS on every new table. Clients cannot write freeze flags, seat counts, audit rows or any application directly; applications are visible only to the two team members, the owning faculty and the admin. Realtime now also covers `system_settings`, `batches`, `batch_members`, `students` and `applications`.
- Bug caught by the new tests: the SDG check accepted `18. …` (it matched the leading `1`); fixed in both the database and the client.

### Tests
81 tests (was 39): the DB tests exercise the seven areas in the brief against real Postgres (see `tests/db/v2.test.ts`), and unit tests cover the Excel file contents (read back from the generated xlsx), PDF generation, and the new validators.

### Assumptions
1. "Batch count decrease" is a **Remaining batches** counter: total stays cadre-based (HOD 3, Associate Chair 2, others 4), Remaining = Total − Formed.
2. "Freeze" locks all allocation activity (global and per faculty) and leaves the portals read-only. A per-faculty freeze does not stop students from sending that faculty new requests; it stops the faculty from responding.
3. "Allocation template change" is the admin Allocations page plus the updated Excel template; it is not a user-editable template builder.
4. Per-student Faculty Advisor / SRM Mail / Contact are prefilled from the faculty profile and are editable per row.
5. "Download form" is a PDF generated in the browser.
6. SDG is typed text with suggestions, not a strict dropdown; only the 1–17 prefix is enforced.
7. One application per team; both members can edit until it is submitted or frozen. An admin can reopen a submitted application.
8. An application belongs to the accepted guide: if the admin removes, moves or resets the acceptance, the student's batch and application are dissolved.
9. "Move to another batch/faculty" is implemented as a move to another **faculty**; the old batch is dissolved. Moving a student between batch slots of the same faculty is done with the faculty's own Edit.
10. A manually entered Student 2 is unverified text. It is checked for duplicates against other applications at save time, but it does not stop that student from later creating their own application.
11. Student 1's SRM mail is prefilled from the student record and editable; the Student 2 mail must be an `srmist.edu.in` address.

### Not verified
- The UI was type-checked, linted and built, but not clicked through in a browser against a live Supabase project; Realtime delivery (including delete events, which Supabase cannot filter) and the PDF's visual layout have not been checked by eye.
- Migration `0005` was applied to a throw-away local Postgres on top of `0001`–`0004`, not to a copy of your production data.
