-- MAPP v3: Faculty Advisors, soft-delete + exempt for students, slimmer admin overview, no designation.
-- Additive and safe on a database that already holds v2 data. The `designation` column itself is
-- dropped in 0010, once the v3 app (which no longer reads it) is deployed.

-- ------------------------------------------------------------ students: active / exempt
alter table public.students
  add column is_active boolean not null default true,
  add column exempt_reason text;
alter table public.students drop constraint if exists students_choice_check;
alter table public.students add constraint students_choice_check check (choice in ('mooc', 'minor', 'exempt'));
create index students_section_norm_idx on public.students (upper(trim(section)));
create index students_active_idx on public.students (is_active);

-- ------------------------------------------------------------ faculty advisors
-- A section (class) has exactly one Faculty Advisor; one advisor may own several sections.
create table public.faculty_advisors (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.faculty (id) on delete cascade,
  section text not null,
  created_at timestamptz not null default now(),
  constraint faculty_advisors_section_uq unique (section),
  constraint faculty_advisors_section_norm check (section = upper(trim(section)) and section <> '')
);
create index faculty_advisors_faculty_idx on public.faculty_advisors (faculty_id);

create function public.faculty_advisors_normalize()
returns trigger language plpgsql as $$
begin
  new.section := upper(trim(new.section));
  return new;
end $$;
create trigger faculty_advisors_norm before insert or update on public.faculty_advisors
  for each row execute function public.faculty_advisors_normalize();

alter table public.faculty_advisors enable row level security;
revoke all on public.faculty_advisors from anon, authenticated;
grant select on public.faculty_advisors to authenticated;
-- clients can never write this table; the admin writes through RPCs, faculty see only their own rows
create policy faculty_advisors_select on public.faculty_advisors for select to authenticated using (
  public.app_role() = 'admin' or (public.app_role() = 'faculty' and faculty_id = auth.uid())
);

-- ------------------------------------------------------------ role helpers honour is_active
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.must_change_password = false
    and (p.role <> 'student' or exists (select 1 from public.students s where s.id = p.id and s.is_active))
$$;

create or replace function public._assert_role(p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text; v_must boolean;
begin
  if auth.uid() is null then raise exception 'You are not signed in.' using errcode = '28000'; end if;
  select role, must_change_password into v_role, v_must from public.profiles where id = auth.uid();
  if v_role is distinct from p_role then raise exception 'You are not allowed to do this.' using errcode = '42501'; end if;
  if v_role = 'student' and not exists (select 1 from public.students where id = auth.uid() and is_active) then
    raise exception 'You are not allowed to do this.' using errcode = '42501';
  end if;
  if v_must then raise exception 'Please change your password before continuing.' using errcode = '42501'; end if;
  if public.consume_request_budget('rpc:' || auth.uid()::text, 120, 60) > 0 then
    raise sqlstate 'PGRST' using
      message = '{"code":"RATE_LIMITED","message":"Too many requests. Please wait a minute.","details":null,"hint":null}',
      detail = '{"status":429,"headers":{"Retry-After":"60"}}';
  end if;
end $$;
revoke all on function public._assert_role(text) from public, anon, authenticated;

-- faculty see only active students who requested them
alter policy students_select on public.students using (
  id = auth.uid()
  or public.app_role() = 'admin'
  or (public.app_role() = 'faculty' and is_active and public.faculty_has_student(id))
);

-- ------------------------------------------------------------ section -> advisor mapping
create function public._norm_section(p text)
returns text language sql immutable as $$ select nullif(upper(trim(coalesce(p, ''))), '') $$;

-- Advisor name of a section. Only faculty and admin may look it up (used by the batch form and sheets).
create function public.fa_name_for_section(p_section text)
returns text language sql stable security definer set search_path = public as $$
  select f.name from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id
  where public.app_role() in ('faculty', 'admin') and a.section = public._norm_section(p_section)
$$;

create function public.is_faculty_advisor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() = 'faculty' and exists (select 1 from public.faculty_advisors where faculty_id = auth.uid())
$$;

create function public.my_fa_sections()
returns setof text language sql stable security definer set search_path = public as $$
  select a.section from public.faculty_advisors a
  where public.app_role() = 'faculty' and a.faculty_id = auth.uid() order by a.section
$$;

-- The caller must be the admin, or the Faculty Advisor of p_section.
create function public._assert_fa_or_admin(p_section text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'admin' then
    perform public._assert_role('admin');
  elsif v_role = 'faculty' then
    perform public._assert_role('faculty');
    if not exists (select 1 from public.faculty_advisors where faculty_id = auth.uid() and section = public._norm_section(p_section)) then
      raise exception 'You are not the Faculty Advisor of this section.' using errcode = '42501';
    end if;
  else
    raise exception 'You are not allowed to do this.' using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------------------ class overview (FA + admin Section view)
-- Status precedence: Exempt > MOOC > Minor > Not opted.
create function public._student_status(p_choice text)
returns text language sql immutable as $$
  select case p_choice when 'exempt' then 'exempt' when 'mooc' then 'mooc' when 'minor' then 'minor' else 'not_opted' end
$$;

create function public.fa_class_counts(p_section text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_sec text := public._norm_section(p_section);
  v jsonb;
begin
  perform public._assert_fa_or_admin(p_section);
  select jsonb_build_object(
    'section', v_sec,
    'total', count(*),
    'minor', count(*) filter (where public._student_status(s.choice) = 'minor'),
    'mooc', count(*) filter (where public._student_status(s.choice) = 'mooc'),
    'not_opted', count(*) filter (where public._student_status(s.choice) = 'not_opted'),
    'exempt', count(*) filter (where public._student_status(s.choice) = 'exempt'),
    'fa_name', (select f.name from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id where a.section = v_sec),
    'fa_emp_id', (select f.emp_id from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id where a.section = v_sec)
  ) into v
  from public.students s where s.is_active and public._norm_section(s.section) = v_sec;
  return v;
end $$;

-- p_page >= 1: one page of 10; p_page = 0: every row (Excel export, capped at 2000).
create function public.fa_class_overview(p_section text, p_search text default null, p_status text default null, p_page int default 1)
returns table (
  student_id uuid, reg_no text, name text, section text, email text, status text,
  guide_name text, request_status text, project_title text, total_count bigint
)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_sec text := public._norm_section(p_section);
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_page int := coalesce(p_page, 1);
begin
  perform public._assert_fa_or_admin(p_section);
  if v_status is not null and v_status not in ('minor', 'mooc', 'not_opted', 'exempt') then
    raise exception 'Invalid status filter.';
  end if;
  return query
    select s.id, s.reg_no, s.name, public._norm_section(s.section), s.email, public._student_status(s.choice),
           case when s.choice = 'minor' then lr.faculty_name end,
           case when lr.status is null or s.choice not in ('minor') and lr.status <> 'declined' then null
                when lr.status = 'accepted' and lr.grouped then 'grouped'
                else lr.status end,
           app.project_title,
           count(*) over ()
    from public.students s
    left join lateral (
      select r.status, f.name as faculty_name,
             exists (select 1 from public.batch_members bm where bm.student_id = r.student_id and bm.project_type = r.project_type) as grouped
      from public.requests r join public.faculty f on f.id = r.faculty_id
      where r.student_id = s.id and r.project_type = 'minor'
      order by r.created_at desc limit 1
    ) lr on true
    left join lateral (
      select a.project_title from public.applications a where s.id in (a.student1_id, a.student2_id) limit 1
    ) app on true
    where s.is_active and public._norm_section(s.section) = v_sec
      and (v_status is null or public._student_status(s.choice) = v_status)
      and (v_search is null or position(v_search in lower(s.reg_no)) > 0 or position(v_search in lower(s.name)) > 0)
    order by s.reg_no
    limit case when v_page < 1 then 2000 else 10 end
    offset case when v_page < 1 then 0 else (v_page - 1) * 10 end;
end $$;

-- ------------------------------------------------------------ admin: overview + lists
drop function public.admin_stats();
create function public.admin_stats()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._assert_role('admin');
  return jsonb_build_object(
    'students', (select count(*) from public.students where is_active),
    'faculty', (select count(*) from public.faculty),
    'minor', (select count(*) from public.students where is_active and choice = 'minor'),
    'mooc', (select count(*) from public.students where is_active and choice = 'mooc'),
    'not_opted', (select count(*) from public.students where is_active and choice is null),
    'exempt', (select count(*) from public.students where is_active and choice = 'exempt')
  );
end $$;

-- kind: mooc | not_opted | exempt | removed. p_page = 0 returns every row (export, capped at 5000).
create function public.admin_list_students(p_kind text, p_search text default null, p_page int default 1)
returns table (
  id uuid, reg_no text, name text, section text, email text, fa_name text, exempt_reason text, total_count bigint
)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page int := coalesce(p_page, 1);
begin
  perform public._assert_role('admin');
  if p_kind not in ('mooc', 'not_opted', 'exempt', 'removed') then raise exception 'Invalid list.'; end if;
  return query
    select s.id, s.reg_no, s.name, public._norm_section(s.section), s.email,
           (select f.name from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id
             where a.section = public._norm_section(s.section)),
           s.exempt_reason,
           count(*) over ()
    from public.students s
    where (case p_kind
             when 'removed' then not s.is_active
             when 'mooc' then s.is_active and s.choice = 'mooc'
             when 'exempt' then s.is_active and s.choice = 'exempt'
             else s.is_active and s.choice is null end)
      and (v_search is null or position(v_search in lower(s.reg_no)) > 0 or position(v_search in lower(s.name)) > 0)
    order by s.reg_no
    limit case when v_page < 1 then 5000 else 10 end
    offset case when v_page < 1 then 0 else (v_page - 1) * 10 end;
end $$;

-- Every section that has at least one active student, with its advisor (if mapped).
create function public.admin_sections()
returns table (section text, student_count bigint, fa_emp_id text, fa_name text)
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._assert_role('admin');
  return query
    select x.sec, x.cnt, f.emp_id, f.name
    from (select public._norm_section(s.section) as sec, count(*) as cnt
          from public.students s where s.is_active and public._norm_section(s.section) is not null group by 1) x
    left join public.faculty_advisors a on a.section = x.sec
    left join public.faculty f on f.id = a.faculty_id
    order by x.sec;
end $$;

create function public.admin_list_advisors(p_search text default null, p_page int default 1)
returns table (section text, fa_emp_id text, fa_name text, student_count bigint, total_count bigint)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page int := coalesce(p_page, 1);
begin
  perform public._assert_role('admin');
  return query
    select a.section, f.emp_id, f.name,
           (select count(*) from public.students s where s.is_active and public._norm_section(s.section) = a.section),
           count(*) over ()
    from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id
    where v_search is null or position(v_search in lower(a.section)) > 0
       or position(v_search in lower(f.emp_id)) > 0 or position(v_search in lower(f.name)) > 0
    order by a.section
    limit case when v_page < 1 then 5000 else 10 end
    offset case when v_page < 1 then 0 else (v_page - 1) * 10 end;
end $$;

-- ------------------------------------------------------------ admin: Faculty Advisor assignment
-- Shared by admin_set_fa and the Excel import (service role). Returns added | replaced | unchanged.
create function public._set_fa(p_emp_id text, p_section text, p_replace boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_fac public.faculty;
  v_sec text := public._norm_section(p_section);
  v_cur public.faculty_advisors;
  v_cur_name text;
begin
  if v_sec is null or length(v_sec) > 20 then raise exception 'Enter a section (up to 20 characters).'; end if;
  select * into v_fac from public.faculty where lower(emp_id) = lower(trim(coalesce(p_emp_id, '')));
  if not found then raise exception 'Unknown employee ID.'; end if;
  if not exists (select 1 from public.students where is_active and public._norm_section(section) = v_sec) then
    raise exception 'Unknown section: no student is in section %.', v_sec;
  end if;
  select * into v_cur from public.faculty_advisors where section = v_sec for update;
  if found then
    if v_cur.faculty_id = v_fac.id then return 'unchanged'; end if;
    select name into v_cur_name from public.faculty where id = v_cur.faculty_id;
    if not coalesce(p_replace, false) then
      raise exception 'Section % is already assigned to %.', v_sec, v_cur_name;
    end if;
    update public.faculty_advisors set faculty_id = v_fac.id where id = v_cur.id;
    return 'replaced';
  end if;
  insert into public.faculty_advisors (faculty_id, section) values (v_fac.id, v_sec);
  return 'added';
exception when unique_violation then
  raise exception 'Section % is already assigned to another advisor.', v_sec;
end $$;
revoke all on function public._set_fa(text, text, boolean) from public, anon, authenticated;
grant execute on function public._set_fa(text, text, boolean) to service_role;

create function public.admin_set_fa(p_emp_id text, p_section text, p_replace boolean default false)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_res text;
begin
  perform public._assert_role('admin');
  v_res := public._set_fa(p_emp_id, p_section, p_replace);
  if v_res <> 'unchanged' then
    perform public._audit('set_advisor', 'advisor', jsonb_build_object(
      'section', public._norm_section(p_section), 'emp_id', trim(p_emp_id), 'result', v_res));
  end if;
  return v_res;
end $$;

create function public.admin_remove_fa(p_section text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp text;
begin
  perform public._assert_role('admin');
  delete from public.faculty_advisors a using public.faculty f
    where a.section = public._norm_section(p_section) and f.id = a.faculty_id returning f.emp_id into v_emp;
  if not found then raise exception 'That section has no Faculty Advisor.'; end if;
  perform public._audit('remove_advisor', 'advisor', jsonb_build_object('section', public._norm_section(p_section), 'emp_id', v_emp));
end $$;

-- ------------------------------------------------------------ admin: remove / exempt students
create function public.admin_remove_students(p_ids uuid[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
  v_req record;
  v_regs text[] := '{}';
  v_reg text;
  v_n int := 0;
begin
  perform public._assert_role('admin');
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'Select between 1 and 500 students.';
  end if;
  for v_id in select distinct unnest(p_ids) order by 1 loop
    select reg_no into v_reg from public.students where id = v_id and is_active for update;
    if not found then continue; end if;
    -- free every seat this student holds, dissolve their batch / application, drop their requests
    for v_req in select id, faculty_id, status from public.requests where student_id = v_id order by id loop
      if v_req.status = 'accepted' then
        perform 1 from public.faculty where id = v_req.faculty_id for update;
        update public.faculty set accepted_count = accepted_count - 1 where id = v_req.faculty_id;
      end if;
    end loop;
    perform public._dissolve_team(v_id, 'minor');
    delete from public.requests where student_id = v_id;
    update public.students set is_active = false, choice = case when choice = 'minor' then null else choice end,
      choice_at = case when choice = 'minor' then null else choice_at end
      where id = v_id;
    v_regs := v_regs || v_reg;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'None of the selected students can be removed.'; end if;
  perform public._audit('remove_students', 'student', jsonb_build_object('count', v_n, 'reg_nos', to_jsonb(v_regs)));
  return v_n;
end $$;

create function public.admin_restore_students(p_ids uuid[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_regs text[];
begin
  perform public._assert_role('admin');
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'Select between 1 and 500 students.';
  end if;
  with r as (update public.students set is_active = true where id = any (p_ids) and not is_active returning reg_no)
  select array_agg(reg_no) into v_regs from r;
  if v_regs is null then raise exception 'None of the selected students are removed.'; end if;
  perform public._audit('restore_students', 'student', jsonb_build_object('count', array_length(v_regs, 1), 'reg_nos', to_jsonb(v_regs)));
  return array_length(v_regs, 1);
end $$;

-- Exempt: the student needs neither MOOC nor Minor. Only students who have not opted can be exempted.
create function public.admin_set_exempt(p_ids uuid[], p_exempt boolean, p_reason text default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_regs text[];
begin
  perform public._assert_role('admin');
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'Select between 1 and 500 students.';
  end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'The reason is too long (200 characters at most).'; end if;
  if coalesce(p_exempt, false) then
    if (select count(*) from public.students where id = any (p_ids) and is_active and choice is null)
       <> (select count(distinct x) from unnest(p_ids) x) then
      raise exception 'Only active students who have not opted for MOOC or Minor can be exempted.';
    end if;
    with r as (update public.students set choice = 'exempt', choice_at = now(), exempt_reason = v_reason
               where id = any (p_ids) and is_active and choice is null returning reg_no)
    select array_agg(reg_no) into v_regs from r;
    perform public._audit('exempt', 'student', jsonb_build_object('count', array_length(v_regs, 1), 'reg_nos', to_jsonb(v_regs), 'reason', v_reason));
  else
    with r as (update public.students set choice = null, choice_at = null, exempt_reason = null
               where id = any (p_ids) and is_active and choice = 'exempt' returning reg_no)
    select array_agg(reg_no) into v_regs from r;
    if v_regs is null then raise exception 'None of the selected students are exempt.'; end if;
    perform public._audit('undo_exempt', 'student', jsonb_build_object('count', array_length(v_regs, 1), 'reg_nos', to_jsonb(v_regs)));
  end if;
  return coalesce(array_length(v_regs, 1), 0);
end $$;

-- ------------------------------------------------------------ student RPCs: exempt + designation
create or replace function public._assert_minor_open()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
begin
  select choice into v_choice from public.students where id = auth.uid();
  if v_choice = 'exempt' then
    raise exception 'You are exempted from MOOC and Minor Project by the admin.';
  end if;
  if v_choice = 'mooc' then
    raise exception 'You have already opted for the MOOC course. The Minor Project dashboard is unavailable.';
  end if;
  if exists (
    select 1 from public.requests
    where student_id = auth.uid() and project_type = 'minor' and status in ('pending', 'accepted')
  ) then
    raise exception 'You already have an active Minor project request.';
  end if;
end $$;

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
  if v_choice = 'exempt' then
    raise exception 'You are exempted from MOOC and Minor Project by the admin.';
  end if;
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

create or replace function public.submit_request(p_faculty_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
  v_avail int;
  v_id uuid;
begin
  perform public._assert_role('student');
  perform public._assert_open();
  select choice into v_choice from public.students where id = auth.uid() for update;
  if not found then raise exception 'Student record not found.'; end if;
  if v_choice = 'exempt' then
    raise exception 'You are exempted from MOOC and Minor Project by the admin.';
  end if;
  if v_choice = 'mooc' then
    raise exception 'You have already opted for the MOOC course. The Minor Project dashboard is unavailable.';
  end if;
  if exists (
    select 1 from public.requests
    where student_id = auth.uid() and project_type = 'minor' and status in ('pending', 'accepted')
  ) then
    raise exception 'You already have an active Minor project request.';
  end if;
  select available_seats into v_avail from public.faculty where id = p_faculty_id;
  if not found then raise exception 'Faculty not found.'; end if;
  if v_avail <= 0 then raise exception 'This faculty has no available seats.'; end if;

  insert into public.requests (student_id, faculty_id) values (auth.uid(), p_faculty_id)
  returning id into v_id;
  update public.students set choice = 'minor', choice_at = now() where id = auth.uid();
  return v_id;
exception when unique_violation then
  raise exception 'You already have an active Minor project request.';
end $$;

-- designation is gone from every student-facing result
drop function public.list_faculty(text, text, int);
create function public.list_faculty(p_search text default null, p_domain text default null, p_page int default 1)
returns table (id uuid, emp_id text, name text, domains text[], total_seats int, available_seats int, total_count bigint)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_domain text := nullif(lower(trim(coalesce(p_domain, ''))), '');
begin
  perform public._assert_role('student');
  perform public._assert_minor_open();
  return query
    select f.id, f.emp_id, f.name, f.domains, f.total_seats, f.available_seats, count(*) over ()
    from public.faculty f
    where f.available_seats > 0
      and (v_search is null or position(v_search in lower(f.name)) > 0 or position(v_search in lower(f.emp_id)) > 0)
      and (v_domain is null or exists (select 1 from unnest(f.domains) d where lower(trim(d)) = v_domain))
    order by f.name, f.emp_id
    limit 10 offset (v_page - 1) * 10;
end $$;

drop function public.get_faculty(uuid);
create function public.get_faculty(p_id uuid)
returns table (id uuid, emp_id text, name text, phone text, venue text, domains text[], available_seats int, total_seats int)
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._assert_role('student');
  perform public._assert_minor_open();
  return query
    select f.id, f.emp_id, f.name, f.phone, f.venue, f.domains, f.available_seats, f.total_seats
    from public.faculty f where f.id = p_id and f.available_seats > 0;
  if not found then raise exception 'This faculty is no longer available.'; end if;
end $$;

drop function public.my_minor_status();
create function public.my_minor_status()
returns table (
  request_id uuid, status text, faculty_id uuid, faculty_emp_id text, faculty_name text,
  phone text, venue text, domains text[], total_seats int, available_seats int,
  requested_at timestamptz, responded_at timestamptz
)
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._assert_role('student');
  return query
    select r.id, r.status, f.id, f.emp_id, f.name, f.phone, f.venue, f.domains,
           f.total_seats, f.available_seats, r.created_at, r.responded_at
    from public.requests r join public.faculty f on f.id = r.faculty_id
    where r.student_id = auth.uid() and r.project_type = 'minor'
    order by r.created_at desc limit 1;
end $$;

drop function public.get_application();
create function public.get_application()
returns table (
  application_id uuid, status text, faculty_id uuid, project_title text, sdg_goal text, problem_by_guide boolean,
  s1_name text, s1_reg text, s1_section text, s1_mail text, s1_mobile text,
  s2_name text, s2_reg text, s2_section text, s2_mail text, s2_mobile text, s2_locked boolean,
  guide_name text, guide_emp_id text, guide_phone text, guide_department text, can_edit boolean
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
    g.name, g.emp_id, g.phone, g.department,
    (coalesce(v_app.status, 'draft') = 'draft' and not (select global_frozen from public.system_settings where id = 1));
end $$;

-- ------------------------------------------------------------ save_batch: advisor name from the section mapping
-- A blank Faculty Advisor Name is filled from the section's mapped advisor; an explicit value is kept (override).
create or replace function public.save_batch(p_batch_no int, p_members jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cadre text;
  v_batch uuid;
  v_m jsonb;
  v_i int := 0;
  v_sids uuid[] := '{}';
  v_secs text[] := '{}';
  v_advs text[] := '{}';
  v_conts text[] := '{}';
  v_mails text[] := '{}';
  v_sid uuid;
  v_sec text;
  v_adv text;
  v_cont text;
  v_mail text;
begin
  perform public._assert_role('faculty');
  perform public._assert_open(auth.uid());
  select cadre into v_cadre from public.faculty where id = auth.uid();
  if p_batch_no is null or p_batch_no < 1 or p_batch_no > public.cadre_batches(v_cadre) then
    raise exception 'Invalid batch number for your cadre.';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) <> 2 then
    raise exception 'Select two different students.';
  end if;

  for v_m in select value from jsonb_array_elements(p_members) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_m) <> 'object' then raise exception 'Select two different students.'; end if;
    begin
      v_sid := (v_m ->> 'student_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Select two different students.';
    end;
    v_sec := trim(coalesce(v_m ->> 'section', ''));
    v_adv := trim(coalesce(v_m ->> 'advisor_name', ''));
    if v_adv = '' then v_adv := coalesce(public.fa_name_for_section(v_sec), ''); end if;
    v_cont := trim(coalesce(v_m ->> 'contact_number', ''));
    v_mail := lower(trim(coalesce(v_m ->> 'srm_mail', '')));
    if v_sid is null then raise exception 'Select two different students.'; end if;
    if v_sec = '' or v_adv = '' then
      raise exception 'Section and Faculty Advisor Name are required for student %.', v_i;
    end if;
    if length(v_sec) > 20 or length(v_adv) > 100 then
      raise exception 'Section or Faculty Advisor Name is too long (student %).', v_i;
    end if;
    if v_cont !~ '^\+?[0-9]{10,13}$' then
      raise exception 'Enter a valid contact number for student %.', v_i;
    end if;
    if length(v_mail) > 200 or v_mail !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
      raise exception 'Enter a valid SRM mail ID for student %.', v_i;
    end if;
    v_sids := v_sids || v_sid;
    v_secs := v_secs || v_sec;
    v_advs := v_advs || v_adv;
    v_conts := v_conts || v_cont;
    v_mails := v_mails || v_mail;
  end loop;
  if v_sids[1] = v_sids[2] then raise exception 'Select two different students.'; end if;

  select id into v_batch from public.batches
    where faculty_id = auth.uid() and project_type = 'minor' and batch_no = p_batch_no for update;

  foreach v_sid in array v_sids loop
    if not exists (
      select 1 from public.requests
      where student_id = v_sid and faculty_id = auth.uid() and project_type = 'minor' and status = 'accepted'
    ) then
      raise exception 'Both students must be accepted by you.';
    end if;
    if exists (
      select 1 from public.batch_members m
      where m.student_id = v_sid and m.project_type = 'minor' and m.batch_id is distinct from v_batch
    ) then
      raise exception 'A selected student is already placed in another batch.';
    end if;
  end loop;

  if v_batch is null then
    insert into public.batches (faculty_id, batch_no) values (auth.uid(), p_batch_no) returning id into v_batch;
  else
    update public.batches set updated_at = now() where id = v_batch;
    delete from public.batch_members where batch_id = v_batch;
  end if;
  insert into public.batch_members (batch_id, slot, student_id, section, advisor_name, contact_number, srm_mail)
  select v_batch, s, v_sids[s], v_secs[s], v_advs[s], v_conts[s], v_mails[s] from generate_series(1, 2) s;
  return v_batch;
end $$;

-- ------------------------------------------------------------ allocation view: title, mobile, advisor; active students only
create or replace view public.request_details_v with (security_invoker = true) as
select
  r.id, r.status, r.project_type, r.created_at, r.responded_at,
  r.faculty_id, f.emp_id as faculty_emp_id, f.name as faculty_name,
  f.cadre as faculty_cadre, f.frozen as faculty_frozen,
  r.student_id, s.reg_no, s.name as student_name, s.dept, s.section as student_section,
  s.email as student_email,
  b.id as batch_id, b.batch_no, bm.slot,
  bm.section as member_section, bm.advisor_name, bm.contact_number, bm.srm_mail,
  coalesce(bm.section, s.section) as section,
  case when r.status = 'accepted' and b.id is not null then 'grouped' else r.status end as display_status,
  case r.status when 'pending' then 0 when 'accepted' then 1 else 2 end as status_rank,
  coalesce(a1.project_title, a2.project_title) as project_title,
  case when a1.id is not null then a1.student1_mobile else a2.student2_mobile end as student_mobile,
  public.fa_name_for_section(s.section) as fa_name
from public.requests r
join public.faculty f on f.id = r.faculty_id
join public.students s on s.id = r.student_id and s.is_active
left join public.batch_members bm
  on bm.student_id = r.student_id and bm.project_type = r.project_type and r.status = 'accepted'
left join public.batches b on b.id = bm.batch_id and b.faculty_id = r.faculty_id
left join public.applications a1 on a1.student1_id = r.student_id and a1.faculty_id = r.faculty_id
left join public.applications a2 on a2.student2_id = r.student_id and a2.faculty_id = r.faculty_id;

-- ------------------------------------------------------------ privileges
revoke execute on function
  public._norm_section(text), public._assert_fa_or_admin(text), public._student_status(text),
  public.faculty_advisors_normalize()
from public, anon, authenticated;

revoke execute on function
  public.fa_name_for_section(text), public.is_faculty_advisor(), public.my_fa_sections(),
  public.fa_class_counts(text), public.fa_class_overview(text, text, text, int),
  public.admin_stats(), public.admin_list_students(text, text, int), public.admin_sections(),
  public.admin_list_advisors(text, int), public.admin_set_fa(text, text, boolean), public.admin_remove_fa(text),
  public.admin_remove_students(uuid[]), public.admin_restore_students(uuid[]),
  public.admin_set_exempt(uuid[], boolean, text),
  public.opt_mooc(numeric), public.submit_request(uuid), public.list_faculty(text, text, int),
  public.get_faculty(uuid), public.my_minor_status(), public.get_application(), public.save_batch(int, jsonb)
from public, anon;
grant execute on function
  public.fa_name_for_section(text), public.is_faculty_advisor(), public.my_fa_sections(),
  public.fa_class_counts(text), public.fa_class_overview(text, text, text, int),
  public.admin_stats(), public.admin_list_students(text, text, int), public.admin_sections(),
  public.admin_list_advisors(text, int), public.admin_set_fa(text, text, boolean), public.admin_remove_fa(text),
  public.admin_remove_students(uuid[]), public.admin_restore_students(uuid[]),
  public.admin_set_exempt(uuid[], boolean, text),
  public.opt_mooc(numeric), public.submit_request(uuid), public.list_faculty(text, text, int),
  public.get_faculty(uuid), public.my_minor_status(), public.get_application(), public.save_batch(int, jsonb)
to authenticated;
notify pgrst, 'reload schema';
