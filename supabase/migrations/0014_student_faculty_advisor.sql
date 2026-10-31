-- Faculty Advisors are mapped per student (students.fa_id), set by the student import from the "FA Email" column,
-- which matches faculty.srm_email. The section -> advisor table and its admin RPCs are removed.
-- A faculty member's advisees are exactly the active students whose fa_id is theirs, whatever section they are in.

alter table public.students add column fa_id uuid references public.faculty (id) on delete set null;
create index students_fa_idx on public.students (fa_id) where fa_id is not null;

-- keep today's assignments: every student inherits the advisor of their section
update public.students s set fa_id = a.faculty_id
  from public.faculty_advisors a
  where a.section = public._norm_section(s.section);

-- ------------------------------------------------------------ helpers
create function public.fa_name_for_student(p_student uuid)
returns text language sql stable security definer set search_path = public as $$
  select f.name from public.students s join public.faculty f on f.id = s.fa_id
  where public.app_role() in ('faculty', 'admin') and s.id = p_student
$$;

create or replace function public.is_faculty_advisor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() = 'faculty' and exists (select 1 from public.students where fa_id = auth.uid() and is_active)
$$;

-- Sections that contain at least one of the caller's advisees (a filter for the advisor page).
create or replace function public.my_fa_sections()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct public._norm_section(s.section) from public.students s
  where public.app_role() = 'faculty' and s.fa_id = auth.uid() and s.is_active and public._norm_section(s.section) is not null
  order by 1
$$;

drop function public._assert_fa_or_admin(text);
-- The caller must be the admin, or a Faculty Advisor with at least one advisee.
create function public._assert_fa_or_admin()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'admin' then
    perform public._assert_role('admin');
  elsif v_role = 'faculty' then
    perform public._assert_role('faculty');
    if not exists (select 1 from public.students where fa_id = auth.uid() and is_active) then
      raise exception 'You are not a Faculty Advisor.' using errcode = '42501';
    end if;
  else
    raise exception 'You are not allowed to do this.' using errcode = '42501';
  end if;
end $$;
revoke all on function public._assert_fa_or_admin() from public, anon, authenticated;

-- ------------------------------------------------------------ MOOC approval follows the student's advisor
create or replace function public.can_read_mooc_request(p_student uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select (p_student=auth.uid() and public.app_role()='student') or public.app_role()='admin'
    or (public.app_role()='faculty' and exists (
      select 1 from public.students s where s.id=p_student and s.is_active and s.fa_id=auth.uid()
    ))
$$;

create or replace function public.opt_mooc(p_cgpa numeric)
returns void language plpgsql security definer set search_path=public as $$
declare v_student public.students; v_request uuid;
begin
  perform public._assert_role('student'); perform public._assert_open();
  if p_cgpa is null or not (p_cgpa >= 9 and p_cgpa <= 10) then raise exception 'CGPA must be at least 9.00 and no higher than 10.'; end if;
  select * into v_student from public.students where id=auth.uid() for update;
  if v_student.choice='exempt' then raise exception 'You are exempted from MOOC and Minor Project by the admin.'; end if;
  if v_student.choice='mooc' then raise exception 'Your MOOC request is already approved.'; end if;
  if v_student.choice='minor' or exists (select 1 from public.requests where student_id=auth.uid() and status in ('pending','accepted')) then
    raise exception 'You have an active Minor project request, so you cannot apply for MOOC.';
  end if;
  if v_student.fa_id is null then
    raise exception 'You have no Faculty Advisor assigned. Contact the admin before applying.';
  end if;
  if v_student.choice='mooc_pending' then
    update public.mooc_requests set cgpa=p_cgpa where student_id=auth.uid() and status='pending' and cgpa is null returning id into v_request;
    if v_request is null then raise exception 'Your MOOC request is already pending Faculty Advisor approval.'; end if;
  else
    insert into public.mooc_requests(student_id,cgpa) values(auth.uid(),p_cgpa);
  end if;
  update public.students set choice='mooc_pending',choice_at=now(),mooc_cgpa=p_cgpa where id=auth.uid();
end $$;

drop function public.fa_mooc_requests(text, text, int);
create function public.fa_mooc_requests(p_section text default null, p_search text default null, p_page int default 1)
returns table(request_id uuid, student_id uuid, reg_no text, name text, section text, email text, cgpa numeric, status text, requested_at timestamptz, total_count bigint)
language plpgsql security definer set search_path=public as $$
declare v_admin boolean;
begin
  perform public._assert_fa_or_admin();
  v_admin := public.app_role() = 'admin';
  return query select r.id,s.id,s.reg_no,s.name,public._norm_section(s.section),s.email,r.cgpa,r.status,r.requested_at,count(*) over()
  from public.mooc_requests r join public.students s on s.id=r.student_id
  where s.is_active and (v_admin or s.fa_id=auth.uid())
    and (public._norm_section(p_section) is null or public._norm_section(s.section)=public._norm_section(p_section))
    and (nullif(trim(p_search),'') is null or position(lower(trim(p_search)) in lower(s.reg_no||' '||s.name))>0)
  order by (r.status='pending') desc,r.requested_at desc,r.id
  limit 10 offset (greatest(coalesce(p_page,1),1)-1)*10;
end $$;

create or replace function public.respond_mooc_request(p_request uuid,p_decision text)
returns void language plpgsql security definer set search_path=public as $$
declare v_request public.mooc_requests; v_student public.students; v_student_id uuid;
begin
  perform public._assert_role('faculty'); perform public._assert_open(auth.uid());
  if p_decision is null or p_decision not in ('approved','declined') then raise exception 'Choose approved or declined.'; end if;
  select student_id into v_student_id from public.mooc_requests where id=p_request;
  if not found then raise exception 'MOOC request not found.'; end if;
  select * into v_student from public.students where id=v_student_id for update;
  select * into v_request from public.mooc_requests where id=p_request for update;
  if v_student.fa_id is distinct from auth.uid() then
    raise exception 'You are not the Faculty Advisor of this student.' using errcode='42501';
  end if;
  if not v_student.is_active then raise exception 'This student is inactive.'; end if;
  if v_request.status<>'pending' then raise exception 'This request has already been reviewed.'; end if;
  if v_student.choice is distinct from 'mooc_pending' then raise exception 'This student no longer has a pending MOOC choice.'; end if;
  if p_decision='approved' and (v_request.cgpa is null or not(v_request.cgpa>=9 and v_request.cgpa<=10)) then
    raise exception 'The student must supply an eligible CGPA before approval.';
  end if;
  update public.mooc_requests set status=p_decision,reviewed_at=now(),reviewed_by=auth.uid() where id=p_request;
  update public.students set choice=case when p_decision='approved' then 'mooc' else null end,
    choice_at=case when p_decision='approved' then now() else null end where id=v_student.id;
  perform public._audit('mooc_'||p_decision,'mooc',jsonb_build_object('student_id',v_student.id,'request_id',p_request,'cgpa',v_request.cgpa));
end $$;

-- ------------------------------------------------------------ class overview (advisor's advisees; admin: whole section)
drop function public.fa_class_counts(text);
create function public.fa_class_counts(p_section text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_sec text := public._norm_section(p_section);
  v_admin boolean;
  v jsonb;
begin
  perform public._assert_fa_or_admin();
  v_admin := public.app_role() = 'admin';
  with mine as (
    select s.* from public.students s
    where s.is_active and (v_admin or s.fa_id = auth.uid())
      and (v_sec is null or public._norm_section(s.section) = v_sec)
  )
  select jsonb_build_object(
    'section', v_sec,
    'total', count(*),
    'minor', count(*) filter (where public._student_status(m.choice) = 'minor'),
    'mooc', count(*) filter (where public._student_status(m.choice) = 'mooc'),
    'mooc_pending', count(*) filter (where m.choice = 'mooc_pending'),
    'not_opted', count(*) filter (where public._student_status(m.choice) = 'not_opted'),
    'exempt', count(*) filter (where public._student_status(m.choice) = 'exempt'),
    'fa_name', (select string_agg(distinct f.name, ', ') from public.faculty f where f.id in (select x.fa_id from mine x)),
    'fa_emp_id', (select string_agg(distinct f.emp_id, ', ') from public.faculty f where f.id in (select x.fa_id from mine x))
  ) into v
  from mine m;
  return v;
end $$;

drop function public.fa_class_overview(text, text, text, int);
-- p_page >= 1: one page of 10; p_page = 0: every row (Excel export, capped at 2000).
create function public.fa_class_overview(p_section text default null, p_search text default null, p_status text default null, p_page int default 1)
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
  v_admin boolean;
begin
  perform public._assert_fa_or_admin();
  v_admin := public.app_role() = 'admin';
  if v_status is not null and v_status not in ('minor', 'mooc', 'mooc_pending', 'not_opted', 'exempt') then
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
    where s.is_active and (v_admin or s.fa_id = auth.uid())
      and (v_sec is null or public._norm_section(s.section) = v_sec)
      and (v_status is null or public._student_status(s.choice) = v_status)
      and (v_search is null or position(v_search in lower(s.reg_no)) > 0 or position(v_search in lower(s.name)) > 0)
    order by s.reg_no
    limit case when v_page < 1 then 2000 else 10 end
    offset case when v_page < 1 then 0 else (v_page - 1) * 10 end;
end $$;

-- ------------------------------------------------------------ admin lists
create or replace function public.admin_list_students(p_kind text, p_search text default null, p_page int default 1)
returns table (
  id uuid, reg_no text, name text, section text, email text, fa_name text, exempt_reason text, total_count bigint
)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page int := coalesce(p_page, 1);
begin
  perform public._assert_role('admin');
  if p_kind not in ('mooc', 'mooc_pending', 'not_opted', 'exempt', 'removed') then raise exception 'Invalid list.'; end if;
  return query
    select s.id, s.reg_no, s.name, public._norm_section(s.section), s.email,
           (select f.name from public.faculty f where f.id = s.fa_id),
           s.exempt_reason,
           count(*) over ()
    from public.students s
    where (case p_kind
             when 'removed' then not s.is_active
             when 'mooc' then s.is_active and s.choice = 'mooc'
             when 'mooc_pending' then s.is_active and s.choice = 'mooc_pending'
             when 'exempt' then s.is_active and s.choice = 'exempt'
             else s.is_active and s.choice is null end)
      and (v_search is null or position(v_search in lower(s.reg_no)) > 0 or position(v_search in lower(s.name)) > 0)
    order by s.reg_no
    limit case when v_page < 1 then 5000 else 10 end
    offset case when v_page < 1 then 0 else (v_page - 1) * 10 end;
end $$;

-- Every section that has at least one active student, with the advisor(s) of its students.
create or replace function public.admin_sections()
returns table (section text, student_count bigint, fa_emp_id text, fa_name text)
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._assert_role('admin');
  return query
    select x.sec, x.cnt, x.emp, x.nm
    from (select public._norm_section(s.section) as sec, count(*) as cnt,
                 string_agg(distinct f.emp_id, ', ') as emp, string_agg(distinct f.name, ', ') as nm
          from public.students s left join public.faculty f on f.id = s.fa_id
          where s.is_active and public._norm_section(s.section) is not null group by 1) x
    order by x.sec;
end $$;

-- ------------------------------------------------------------ batch form / allocation sheet: the student's own advisor
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
    if v_adv = '' then v_adv := coalesce(public.fa_name_for_student(v_sid), ''); end if;
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
  public.fa_name_for_student(s.id) as fa_name
from public.requests r
join public.faculty f on f.id = r.faculty_id
join public.students s on s.id = r.student_id and s.is_active
left join public.batch_members bm
  on bm.student_id = r.student_id and bm.project_type = r.project_type and r.status = 'accepted'
left join public.batches b on b.id = bm.batch_id and b.faculty_id = r.faculty_id
left join public.applications a1 on a1.student1_id = r.student_id and a1.faculty_id = r.faculty_id
left join public.applications a2 on a2.student2_id = r.student_id and a2.faculty_id = r.faculty_id;

-- ------------------------------------------------------------ remove the section mapping
drop function public.fa_name_for_section(text);
drop function public.admin_list_advisors(text, int);
drop function public.admin_set_fa(text, text, boolean);
drop function public.admin_remove_fa(text);
drop function public._set_fa(text, text, boolean);
drop table public.faculty_advisors;
drop function public.faculty_advisors_normalize();

-- ------------------------------------------------------------ privileges
revoke execute on function
  public.fa_name_for_student(uuid), public.is_faculty_advisor(), public.my_fa_sections(),
  public.fa_class_counts(text), public.fa_class_overview(text, text, text, int), public.fa_mooc_requests(text, text, int),
  public.respond_mooc_request(uuid, text), public.opt_mooc(numeric), public.save_batch(int, jsonb),
  public.admin_list_students(text, text, int), public.admin_sections(), public.can_read_mooc_request(uuid)
from public, anon;
grant execute on function
  public.fa_name_for_student(uuid), public.is_faculty_advisor(), public.my_fa_sections(),
  public.fa_class_counts(text), public.fa_class_overview(text, text, text, int), public.fa_mooc_requests(text, text, int),
  public.respond_mooc_request(uuid, text), public.opt_mooc(numeric), public.save_batch(int, jsonb),
  public.admin_list_students(text, text, int), public.admin_sections(), public.can_read_mooc_request(uuid)
to authenticated;
notify pgrst, 'reload schema';
