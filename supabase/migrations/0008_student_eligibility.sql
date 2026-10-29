-- Student eligibility and guide details. Existing MOOC choices are preserved.
alter table public.students add column mooc_cgpa numeric check (mooc_cgpa > 9 and mooc_cgpa <= 10);
alter table public.faculty add column department text not null default 'Computing Technologies';
drop function public.opt_mooc();
create or replace function public.opt_mooc(p_cgpa numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
begin
  perform public._assert_role('student');
  perform public._assert_open();
  if p_cgpa is null or not (p_cgpa > 9 and p_cgpa <= 10) then
    raise exception 'CGPA must be greater than 9 and no higher than 10.';
  end if;
  select choice into v_choice from public.students where id = auth.uid() for update;
  if not found then raise exception 'Student record not found.'; end if;
  if v_choice = 'mooc' then
    raise exception 'You have already opted for the MOOC course.';
  end if;
  if v_choice = 'minor' or exists (
    select 1 from public.requests
    where student_id = auth.uid() and project_type = 'minor' and status in ('pending', 'accepted')
  ) then
    raise exception 'You have an active Minor project request, so you cannot opt for MOOC.';
  end if;
  update public.students set choice = 'mooc', choice_at = now(), mooc_cgpa = p_cgpa where id = auth.uid();
end $$;


revoke all on function public.opt_mooc(numeric) from public, anon;
grant execute on function public.opt_mooc(numeric) to authenticated;
create or replace function public._my_accepted_faculty()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v uuid;
begin
  select faculty_id into v from public.requests
    where student_id = auth.uid() and project_type = 'minor' and status = 'accepted';
  if v is null then
    raise exception 'The Application Form opens only after your guide accepts your request.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.batch_members m
    join public.batches b on b.id = m.batch_id
    where m.student_id = auth.uid() and m.project_type = 'minor' and b.faculty_id = v
      and (select count(*) from public.batch_members peers where peers.batch_id = b.id) = 2
  ) then
    raise exception 'The Application Form opens only after your guide completes your batch.' using errcode = '42501';
  end if;
  return v;
end $$;


drop function public.get_application();
create function public.get_application()
returns table (
  application_id uuid, status text, faculty_id uuid, project_title text, sdg_goal text, problem_by_guide boolean,
  s1_name text, s1_reg text, s1_section text, s1_mail text, s1_mobile text,
  s2_name text, s2_reg text, s2_section text, s2_mail text, s2_mobile text, s2_locked boolean,
  guide_name text, guide_emp_id text, guide_phone text, guide_designation text, guide_department text, can_edit boolean
)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_fac uuid;
  v_partner uuid;
  v_app public.applications;
  v_s1 uuid;
  v_s2 uuid;
  a public.students;
  b public.students;
  g public.faculty;
begin
  perform public._assert_role('student');
  v_fac := public._my_accepted_faculty();
  v_partner := public._my_batch_partner();
  v_app := public._team_application(v_partner);

  if v_app.id is not null then
    v_s1 := v_app.student1_id;
    v_s2 := coalesce(v_app.student2_id, case when v_app.student1_id = auth.uid() then v_partner end);
  else
    v_s1 := auth.uid();
    v_s2 := v_partner;
  end if;
  select * into a from public.students where id = v_s1;
  select * into b from public.students where id = v_s2;
  select * into g from public.faculty where id = v_fac;

  return query select
    v_app.id, coalesce(v_app.status, 'draft'), v_fac, v_app.project_title, v_app.sdg_goal, v_app.problem_by_guide,
    a.name, a.reg_no, a.section, coalesce(v_app.student1_mail, a.email), v_app.student1_mobile,
    coalesce(b.name, v_app.student2_name), coalesce(b.reg_no, v_app.student2_reg),
    coalesce(b.section, v_app.student2_section),
    coalesce(v_app.student2_mail, b.email), v_app.student2_mobile, (v_s2 is not null),
    g.name, g.emp_id, g.phone, g.designation, g.department,
    (coalesce(v_app.status, 'draft') = 'draft' and not (select global_frozen from public.system_settings where id = 1));
end $$;


revoke all on function public.get_application() from public, anon;
grant execute on function public.get_application() to authenticated;
-- Students may read their own batch membership for the navigation lock.
create policy batch_members_select_own on public.batch_members for select to authenticated
  using (student_id = auth.uid() and public.app_role() = 'student');
-- Use the same completed-batch requirement for direct table reads.
create function public.student_has_application_batch()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.batch_members m
    join public.batches b on b.id = m.batch_id
    join public.requests r on r.student_id = m.student_id and r.faculty_id = b.faculty_id
      and r.project_type = 'minor' and r.status = 'accepted'
    where m.student_id = auth.uid() and m.project_type = 'minor'
      and (select count(*) from public.batch_members peers where peers.batch_id = b.id) = 2
  )
$$;
revoke all on function public.student_has_application_batch() from public, anon;
grant execute on function public.student_has_application_batch() to authenticated;
alter policy applications_select on public.applications using (
  (public.app_role() = 'student' and (student1_id = auth.uid() or student2_id = auth.uid())
    and public.student_has_application_batch())
  or (public.app_role() = 'faculty' and faculty_id = auth.uid())
  or public.app_role() = 'admin'
);
notify pgrst, 'reload schema';
