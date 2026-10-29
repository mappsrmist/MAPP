-- Apply before deploying the approval UI. Existing automatic selections require review.
alter table public.students drop constraint students_mooc_cgpa_check;
alter table public.students add constraint students_mooc_cgpa_check check (mooc_cgpa >= 9 and mooc_cgpa <= 10);
alter table public.students drop constraint students_choice_check;
alter table public.students add constraint students_choice_check check (choice in ('minor','mooc','mooc_pending','exempt'));

create table public.mooc_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  cgpa numeric check (cgpa >= 9 and cgpa <= 10),
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
create unique index mooc_requests_one_pending on public.mooc_requests(student_id) where status='pending';
create index mooc_requests_student on public.mooc_requests(student_id, requested_at desc);
alter table public.mooc_requests enable row level security;
revoke all on public.mooc_requests from anon, authenticated;
grant select on public.mooc_requests to authenticated;
create function public.can_read_mooc_request(p_student uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select (p_student=auth.uid() and public.app_role()='student') or public.app_role()='admin'
    or (public.app_role()='faculty' and exists (
      select 1 from public.students s join public.faculty_advisors a on a.section=public._norm_section(s.section)
      where s.id=p_student and s.is_active and a.faculty_id=auth.uid()
    ))
$$;
revoke all on function public.can_read_mooc_request(uuid) from public,anon;
grant execute on function public.can_read_mooc_request(uuid) to authenticated;
create policy mooc_requests_read on public.mooc_requests for select to authenticated
  using (public.can_read_mooc_request(student_id));
insert into public.mooc_requests(student_id,cgpa,requested_at)
  select id,mooc_cgpa,coalesce(choice_at,now()) from public.students where choice='mooc';
update public.students set choice='mooc_pending' where choice='mooc';
alter publication supabase_realtime add table public.mooc_requests;

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
  if not exists (select 1 from public.faculty_advisors where section=public._norm_section(v_student.section)) then
    raise exception 'Your section has no Faculty Advisor assigned. Contact the admin before applying.';
  end if;
  if v_student.choice='mooc_pending' then
    -- Legacy selections may lack a CGPA. Allow it to be supplied before review.
    update public.mooc_requests set cgpa=p_cgpa where student_id=auth.uid() and status='pending' and cgpa is null returning id into v_request;
    if v_request is null then raise exception 'Your MOOC request is already pending Faculty Advisor approval.'; end if;
  else
    insert into public.mooc_requests(student_id,cgpa) values(auth.uid(),p_cgpa);
  end if;
  update public.students set choice='mooc_pending',choice_at=now(),mooc_cgpa=p_cgpa where id=auth.uid();
end $$;

create function public.fa_mooc_requests(p_section text, p_search text default null, p_page int default 1)
returns table(request_id uuid, student_id uuid, reg_no text, name text, section text, email text, cgpa numeric, status text, requested_at timestamptz, total_count bigint)
language plpgsql security definer set search_path=public as $$
begin
  perform public._assert_fa_or_admin(p_section);
  return query select r.id,s.id,s.reg_no,s.name,public._norm_section(s.section),s.email,r.cgpa,r.status,r.requested_at,count(*) over()
  from public.mooc_requests r join public.students s on s.id=r.student_id
  where s.is_active and public._norm_section(s.section)=public._norm_section(p_section)
    and (nullif(trim(p_search),'') is null or position(lower(trim(p_search)) in lower(s.reg_no||' '||s.name))>0)
  order by (r.status='pending') desc,r.requested_at desc,r.id
  limit 10 offset (greatest(coalesce(p_page,1),1)-1)*10;
end $$;

create function public.respond_mooc_request(p_request uuid,p_decision text)
returns void language plpgsql security definer set search_path=public as $$
declare v_request public.mooc_requests; v_student public.students; v_student_id uuid;
begin
  perform public._assert_role('faculty'); perform public._assert_open(auth.uid());
  if p_decision is null or p_decision not in ('approved','declined') then raise exception 'Choose approved or declined.'; end if;
  select student_id into v_student_id from public.mooc_requests where id=p_request;
  if not found then raise exception 'MOOC request not found.'; end if;
  select * into v_student from public.students where id=v_student_id for update;
  select * into v_request from public.mooc_requests where id=p_request for update;
  if not exists (select 1 from public.faculty_advisors where faculty_id=auth.uid() and section=public._norm_section(v_student.section)) then
    raise exception 'You are not the Faculty Advisor of this section.' using errcode='42501';
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

revoke all on function public.fa_mooc_requests(text,text,int),public.respond_mooc_request(uuid,text) from public,anon;
grant execute on function public.fa_mooc_requests(text,text,int),public.respond_mooc_request(uuid,text) to authenticated;

create or replace function public._assert_minor_open()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
begin
  select choice into v_choice from public.students where id = auth.uid();
  if v_choice = 'exempt' then
    raise exception 'You are exempted from MOOC and Minor Project by the admin.';
  end if;
  if v_choice in ('mooc', 'mooc_pending') then
    raise exception 'You have already opted for the MOOC course. The Minor Project dashboard is unavailable.';
  end if;
  if exists (
    select 1 from public.requests
    where student_id = auth.uid() and project_type = 'minor' and status in ('pending', 'accepted')
  ) then
    raise exception 'You already have an active Minor project request.';
  end if;
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
  if v_choice in ('mooc', 'mooc_pending') then
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

create or replace function public.admin_reset_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
  v_choice text;
begin
  perform public._assert_role('admin');
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_req.status = 'pending' then raise exception 'This request is already pending.'; end if;

  if v_req.status = 'accepted' then
    perform 1 from public.faculty where id = v_req.faculty_id for update;
    perform public._dissolve_team(v_req.student_id, v_req.project_type);
    update public.faculty set accepted_count = accepted_count - 1 where id = v_req.faculty_id;
  else
    select choice into v_choice from public.students where id = v_req.student_id for update;
    if v_choice in ('mooc', 'mooc_pending') then raise exception 'The student has opted for MOOC. Undo that first.'; end if;
    if exists (
      select 1 from public.requests
      where student_id = v_req.student_id and project_type = v_req.project_type
        and status in ('pending', 'accepted') and id <> p_request_id
    ) then
      raise exception 'The student already has another active request.';
    end if;
    update public.students set choice = 'minor', choice_at = now() where id = v_req.student_id;
  end if;
  update public.requests set status = 'pending', responded_at = null where id = p_request_id;
  perform public._audit('reset_request', 'allocation', public._audit_alloc(v_req.student_id, v_req.faculty_id) || jsonb_build_object('was', v_req.status));
end $$;

create or replace function public._student_status(p_choice text)
returns text language sql immutable as $$
  select case p_choice when 'exempt' then 'exempt' when 'mooc' then 'mooc' when 'mooc_pending' then 'mooc_pending' when 'minor' then 'minor' else 'not_opted' end
$$;

create or replace function public.fa_class_counts(p_section text)
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
    'mooc_pending', count(*) filter (where s.choice = 'mooc_pending'),
    'not_opted', count(*) filter (where public._student_status(s.choice) = 'not_opted'),
    'exempt', count(*) filter (where public._student_status(s.choice) = 'exempt'),
    'fa_name', (select f.name from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id where a.section = v_sec),
    'fa_emp_id', (select f.emp_id from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id where a.section = v_sec)
  ) into v
  from public.students s where s.is_active and public._norm_section(s.section) = v_sec;
  return v;
end $$;

-- p_page >= 1: one page of 10; p_page = 0: every row (Excel export, capped at 2000).
create or replace function public.fa_class_overview(p_section text, p_search text default null, p_status text default null, p_page int default 1)
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
    where s.is_active and public._norm_section(s.section) = v_sec
      and (v_status is null or public._student_status(s.choice) = v_status)
      and (v_search is null or position(v_search in lower(s.reg_no)) > 0 or position(v_search in lower(s.name)) > 0)
    order by s.reg_no
    limit case when v_page < 1 then 2000 else 10 end
    offset case when v_page < 1 then 0 else (v_page - 1) * 10 end;
end $$;



create or replace function public.admin_stats()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._assert_role('admin');
  return jsonb_build_object(
    'students', (select count(*) from public.students where is_active),
    'faculty', (select count(*) from public.faculty),
    'minor', (select count(*) from public.students where is_active and choice = 'minor'),
    'mooc', (select count(*) from public.students where is_active and choice = 'mooc'),
    'mooc_pending', (select count(*) from public.students where is_active and choice = 'mooc_pending'),
    'not_opted', (select count(*) from public.students where is_active and choice is null),
    'exempt', (select count(*) from public.students where is_active and choice = 'exempt')
  );
end $$;

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
           (select f.name from public.faculty_advisors a join public.faculty f on f.id = a.faculty_id
             where a.section = public._norm_section(s.section)),
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
-- Admin reset must release the outstanding request as well as the student's choice.
create or replace function public.admin_reset_choice(p_student_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public._assert_role('admin');
  perform 1 from public.students where id=p_student_id for update;
  if not found then raise exception 'Student not found.'; end if;
  if exists (select 1 from public.requests where student_id=p_student_id and status in ('pending','accepted')) then
    raise exception 'Student has an active request. Remove it first.';
  end if;
  update public.mooc_requests set status='cancelled', reviewed_at=now(), reviewed_by=auth.uid()
    where student_id=p_student_id and status='pending';
  update public.students set choice=null,choice_at=null,mooc_cgpa=null where id=p_student_id;
  perform public._audit('reset_choice','student',jsonb_build_object('student_id',p_student_id));
end $$;
