-- MAPP: RESET ALL DATA (testing only).
--
-- Run this in the Supabase SQL editor. It deletes every user and everything that belongs to them,
-- so the project goes back to a clean, just-migrated state: students, faculty, requests, batches,
-- applications, the audit log, login throttle counters and the freeze switch are all cleared.
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
  -- Deleting the auth user cascades to profiles -> students / faculty -> requests, batches,
  -- batch_members, applications (all declared `on delete cascade`), plus sessions and identities.
  delete from auth.users
  where id not in (
    select id from public.profiles where keep_admin and role = 'admin'
  );

  -- belt and braces: profiles of deleted users are gone already, but clear any strays
  delete from public.profiles where not (keep_admin and role = 'admin');

  truncate table public.audit_log restart identity;
  truncate table public.auth_throttle;

  update public.system_settings set global_frozen = false, updated_by = null, updated_at = now() where id = 1;
end $$;

-- What is left (admin only, everything else 0):
select
  (select count(*) from auth.users)            as auth_users,
  (select count(*) from public.profiles)       as profiles,
  (select count(*) from public.students)       as students,
  (select count(*) from public.faculty)        as faculty,
  (select count(*) from public.requests)       as requests,
  (select count(*) from public.batches)        as batches,
  (select count(*) from public.applications)   as applications,
  (select count(*) from public.audit_log)      as audit_log;
