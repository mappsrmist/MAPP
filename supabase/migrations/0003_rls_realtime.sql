-- Row Level Security: default deny. The browser can only SELECT; every write goes
-- through the SECURITY DEFINER RPCs or service-role route handlers.
-- app_role() returns NULL while must_change_password is true, so a user who has not
-- yet changed their initial password is denied everywhere except their own profile.

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.faculty enable row level security;
alter table public.requests enable row level security;
alter table public.batches enable row level security;
alter table public.batch_members enable row level security;

-- No client writes at all (defence in depth on top of the missing policies).
revoke all on public.profiles, public.students, public.faculty, public.requests,
  public.batches, public.batch_members from anon, authenticated;
grant select on public.profiles, public.students, public.faculty, public.requests,
  public.batches, public.batch_members to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.app_role() = 'admin');

-- students: own row; faculty see only students who requested them; admin sees all.
create policy students_select on public.students for select to authenticated using (
  id = auth.uid()
  or public.app_role() = 'admin'
  or (public.app_role() = 'faculty' and public.faculty_has_student(id))
);

-- faculty: students never read this table directly (they use list_faculty / get_faculty,
-- which expose only the needed columns). A faculty member reads their own row.
create policy faculty_select on public.faculty for select to authenticated using (
  (id = auth.uid() and public.app_role() = 'faculty') or public.app_role() = 'admin'
);

create policy requests_select on public.requests for select to authenticated using (
  (student_id = auth.uid() and public.app_role() = 'student')
  or (faculty_id = auth.uid() and public.app_role() = 'faculty')
  or public.app_role() = 'admin'
);

create policy batches_select on public.batches for select to authenticated using (
  (faculty_id = auth.uid() and public.app_role() = 'faculty') or public.app_role() = 'admin'
);

create policy batch_members_select on public.batch_members for select to authenticated using (
  public.app_role() = 'admin'
  or (public.app_role() = 'faculty' and exists (
    select 1 from public.batches b where b.id = batch_id and b.faculty_id = auth.uid()
  ))
);

-- One flat view used by the faculty "Students Approached" list, the batch dropdowns and the
-- admin allocation tables. security_invoker => the caller's RLS still applies.
create or replace view public.request_details_v with (security_invoker = true) as
select
  r.id, r.status, r.project_type, r.created_at, r.responded_at,
  r.faculty_id, f.emp_id as faculty_emp_id, f.name as faculty_name,
  r.student_id, s.reg_no, s.name as student_name, s.dept, s.section as student_section,
  s.email as student_email,
  b.batch_no, bm.slot,
  case r.status when 'pending' then 0 when 'accepted' then 1 else 2 end as status_rank
from public.requests r
join public.faculty f on f.id = r.faculty_id
join public.students s on s.id = r.student_id
left join public.batch_members bm
  on bm.student_id = r.student_id and bm.project_type = r.project_type and r.status = 'accepted'
left join public.batches b on b.id = bm.batch_id and b.faculty_id = r.faculty_id;

revoke all on public.request_details_v from anon, authenticated;
grant select on public.request_details_v to authenticated;

-- Realtime: seat changes + request status changes (RLS filters what each user receives).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.faculty;
    alter publication supabase_realtime add table public.requests;
  end if;
end $$;
