-- MAPP: RESET ALL DATA (testing only).
--
-- Run this in the Supabase SQL editor. It deletes every user and everything that belongs to them,
-- so the project goes back to a clean, just-migrated state: students, faculty, faculty advisors,
-- requests, batches, batch members, applications, the audit log, login throttle counters,
-- request rate-limit budgets, and the global freeze switch are all cleared.
--
-- It keeps the schema, functions, policies and migrations (no need to re-run them).
-- It is NOT a migration: do not put it in supabase/migrations, and never run it on production.
--
-- The admin account (mappCtech) is KEPT so you can sign in and import data straight away.
-- For a complete wipe including the admin, change `keep_admin` to false and run
-- `npm run seed:admin` afterwards.

do $$
declare
  keep_admin constant boolean := true;
begin
  -- Deleting the auth user cascades to:
  --   profiles -> students / faculty -> faculty_advisors, batches -> batch_members,
  --   requests, applications (all declared `on delete cascade`), plus auth sessions/identities.
  delete from auth.users
  where id not in (
    select id from public.profiles where keep_admin and role = 'admin'
  );

  -- Belt and braces: profiles of deleted users are gone already, but clear any strays
  delete from public.profiles where not (keep_admin and role = 'admin');

  -- Clear section-to-faculty advisor mappings
  truncate table public.faculty_advisors;

  -- Reset audit trail and rate-limiting / throttle counters
  truncate table public.audit_log restart identity;
  truncate table public.auth_throttle;
  truncate table public.request_budgets;

  -- Ensure system settings exist and global freeze is turned off
  insert into public.system_settings (id, global_frozen, updated_by, updated_at)
  values (1, false, null, now())
  on conflict (id) do update set global_frozen = false, updated_by = null, updated_at = now();
end $$;

-- What is left (admin only, everything else 0):
select
  (select count(*) from auth.users)                                                 as auth_users,
  (select count(*) from public.profiles)                                            as profiles,
  (select count(*) from public.students)                                            as students,
  (select count(*) from public.faculty)                                             as faculty,
  (select count(*) from public.faculty_advisors)                                    as faculty_advisors,
  (select count(*) from public.requests)                                            as requests,
  (select count(*) from public.batches)                                             as batches,
  (select count(*) from public.batch_members)                                       as batch_members,
  (select count(*) from public.applications)                                        as applications,
  (select count(*) from public.audit_log)                                           as audit_log,
  (select count(*) from public.auth_throttle)                                       as auth_throttle,
  (select count(*) from public.request_budgets)                                     as request_budgets,
  (select coalesce(global_frozen, false) from public.system_settings where id = 1)  as global_frozen;
