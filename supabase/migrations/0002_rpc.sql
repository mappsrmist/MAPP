-- MAPP RPCs. All are SECURITY DEFINER with a pinned search_path and verify
-- auth.uid() + role inside. Users who must still change their password are rejected.
--
-- Lock order (prevents deadlocks): student row -> request row -> faculty row.
-- Decline never touches the faculty row; accept never touches the student row.

create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and must_change_password = false
$$;

create or replace function public.faculty_has_student(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests where student_id = p_student and faculty_id = auth.uid())
$$;

create or replace function public._assert_role(p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_must boolean;
begin
  if auth.uid() is null then
    raise exception 'You are not signed in.' using errcode = '28000';
  end if;
  select role, must_change_password into v_role, v_must from public.profiles where id = auth.uid();
  if v_role is distinct from p_role then
    raise exception 'You are not allowed to do this.' using errcode = '42501';
  end if;
  if v_must then
    raise exception 'Please change your password before continuing.' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------- student
create or replace function public.opt_mooc()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
begin
  perform public._assert_role('student');
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
  update public.students set choice = 'mooc', choice_at = now() where id = auth.uid();
end $$;

create or replace function public._assert_minor_open()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
begin
  select choice into v_choice from public.students where id = auth.uid();
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

create or replace function public.submit_request(p_faculty_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
  v_avail int;
  v_id uuid;
begin
  perform public._assert_role('student');
  select choice into v_choice from public.students where id = auth.uid() for update;
  if not found then raise exception 'Student record not found.'; end if;
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

create or replace function public.list_faculty(
  p_search text default null,
  p_domain text default null,
  p_page int default 1
)
returns table (id uuid, emp_id text, name text, designation text, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_domain text := nullif(trim(coalesce(p_domain, '')), '');
begin
  perform public._assert_role('student');
  perform public._assert_minor_open();
  return query
    select f.id, f.emp_id, f.name, f.designation, count(*) over ()
    from public.faculty f
    where f.available_seats > 0
      and (v_search is null or position(v_search in lower(f.name)) > 0 or position(v_search in lower(f.emp_id)) > 0)
      and (v_domain is null or v_domain = any (f.domains))
    order by f.name, f.emp_id
    limit 10 offset (v_page - 1) * 10;
end $$;

create or replace function public.list_domains()
returns setof text language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_role('student');
  return query
    select distinct trim(d) from public.faculty f, unnest(f.domains) as d
    where f.available_seats > 0 and trim(d) <> '' order by trim(d);
end $$;

create or replace function public.get_faculty(p_id uuid)
returns table (
  id uuid, emp_id text, name text, designation text, phone text, venue text,
  domains text[], available_seats int, total_seats int
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_role('student');
  perform public._assert_minor_open();
  return query
    select f.id, f.emp_id, f.name, f.designation, f.phone, f.venue, f.domains, f.available_seats, f.total_seats
    from public.faculty f where f.id = p_id and f.available_seats > 0;
  if not found then raise exception 'This faculty is no longer available.'; end if;
end $$;

-- The caller's most recent Minor request, with the faculty's contact details.
create or replace function public.my_minor_status()
returns table (
  request_id uuid, status text, faculty_id uuid, faculty_emp_id text, faculty_name text,
  designation text, phone text, venue text, requested_at timestamptz, responded_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_role('student');
  return query
    select r.id, r.status, f.id, f.emp_id, f.name, f.designation, f.phone, f.venue, r.created_at, r.responded_at
    from public.requests r join public.faculty f on f.id = r.faculty_id
    where r.student_id = auth.uid() and r.project_type = 'minor'
    order by r.created_at desc limit 1;
end $$;

-- ---------------------------------------------------------------- faculty
create or replace function public.respond_request(p_request_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
  v_count int;
  v_total int;
begin
  perform public._assert_role('faculty');
  if p_status not in ('accepted', 'declined') then
    raise exception 'Invalid status.';
  end if;
  select * into v_req from public.requests
    where id = p_request_id and faculty_id = auth.uid() for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been %.', v_req.status;
  end if;

  if p_status = 'accepted' then
    select accepted_count, total_seats into v_count, v_total
      from public.faculty where id = auth.uid() for update;
    if v_count >= v_total then
      raise exception 'No seats available. You can only decline remaining requests.';
    end if;
    update public.faculty set accepted_count = accepted_count + 1 where id = auth.uid();
    update public.requests set status = 'accepted', responded_at = now() where id = p_request_id;
  else
    update public.requests set status = 'declined', responded_at = now() where id = p_request_id;
    -- unlock the student's Minor portal
    update public.students set choice = null, choice_at = null
      where id = v_req.student_id and choice = 'minor';
  end if;
end $$;

create or replace function public.save_batch(
  p_batch_no int, p_student1 uuid, p_student2 uuid,
  p_section text, p_advisor text, p_contact text, p_mail text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cadre text;
  v_batch uuid;
  v_sid uuid;
begin
  perform public._assert_role('faculty');
  select cadre into v_cadre from public.faculty where id = auth.uid();
  if p_batch_no is null or p_batch_no < 1 or p_batch_no > public.cadre_batches(v_cadre) then
    raise exception 'Invalid batch number for your cadre.';
  end if;
  if p_student1 is null or p_student2 is null or p_student1 = p_student2 then
    raise exception 'Select two different students.';
  end if;
  if coalesce(trim(p_section), '') = '' or coalesce(trim(p_advisor), '') = '' then
    raise exception 'Section and Faculty Advisor Name are required.';
  end if;
  if p_contact !~ '^\+?[0-9]{10,13}$' then
    raise exception 'Enter a valid contact number.';
  end if;
  if p_mail !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'Enter a valid SRM mail ID.';
  end if;

  select id into v_batch from public.batches
    where faculty_id = auth.uid() and project_type = 'minor' and batch_no = p_batch_no for update;

  foreach v_sid in array array[p_student1, p_student2] loop
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
    insert into public.batches (faculty_id, batch_no, section, advisor_name, contact_number, srm_mail)
    values (auth.uid(), p_batch_no, trim(p_section), trim(p_advisor), p_contact, lower(trim(p_mail)))
    returning id into v_batch;
  else
    update public.batches set section = trim(p_section), advisor_name = trim(p_advisor),
      contact_number = p_contact, srm_mail = lower(trim(p_mail)) where id = v_batch;
    delete from public.batch_members where batch_id = v_batch;
  end if;
  insert into public.batch_members (batch_id, slot, student_id) values (v_batch, 1, p_student1), (v_batch, 2, p_student2);
  return v_batch;
end $$;

create or replace function public.clear_batch(p_batch_no int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_role('faculty');
  delete from public.batches
    where faculty_id = auth.uid() and project_type = 'minor' and batch_no = p_batch_no;
end $$;

-- ------------------------------------------------------------------ admin
-- Remove an accepted student from a faculty: frees the seat and unlocks the student.
create or replace function public.admin_remove_accepted(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
  v_batch uuid;
begin
  perform public._assert_role('admin');
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_req.status <> 'accepted' then raise exception 'Only accepted requests can be removed.'; end if;
  perform 1 from public.faculty where id = v_req.faculty_id for update;
  select batch_id into v_batch from public.batch_members
    where student_id = v_req.student_id and project_type = v_req.project_type;
  if v_batch is not null then
    delete from public.batches where id = v_batch;
  else
    delete from public.batch_members where student_id = v_req.student_id and project_type = v_req.project_type;
  end if;
  update public.faculty set accepted_count = accepted_count - 1 where id = v_req.faculty_id;
  update public.requests set status = 'declined', responded_at = now() where id = p_request_id;
  update public.students set choice = null, choice_at = null where id = v_req.student_id and choice = 'minor';
end $$;

-- Admin can undo a student's MOOC choice (a student cannot switch on their own).
create or replace function public.admin_reset_choice(p_student_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_role('admin');
  if exists (
    select 1 from public.requests
    where student_id = p_student_id and status in ('pending', 'accepted')
  ) then
    raise exception 'Student has an active request. Remove it first.';
  end if;
  update public.students set choice = null, choice_at = null where id = p_student_id;
end $$;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public._assert_role('admin');
  select jsonb_build_object(
    'students', (select count(*) from public.students),
    'faculty', (select count(*) from public.faculty),
    'mooc', (select count(*) from public.students where choice = 'mooc'),
    'pending', (select count(*) from public.requests where status = 'pending'),
    'accepted', (select count(*) from public.requests where status = 'accepted'),
    'declined', (select count(*) from public.requests where status = 'declined'),
    'no_choice', (select count(*) from public.students where choice is null),
    'total_seats', (select coalesce(sum(total_seats), 0) from public.faculty),
    'filled_seats', (select coalesce(sum(accepted_count), 0) from public.faculty)
  ) into v;
  return v;
end $$;

-- ------------------------------------------------------------- privileges
-- Supabase's default privileges grant EXECUTE on new functions to anon/authenticated, so revoke
-- explicitly from all three and re-grant only the public RPC surface. Internal helpers
-- (_assert_*, trigger functions) stay unreachable from the API.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.opt_mooc(), public.submit_request(uuid), public.list_faculty(text, text, int),
  public.list_domains(), public.get_faculty(uuid), public.my_minor_status(),
  public.respond_request(uuid, text),
  public.save_batch(int, uuid, uuid, text, text, text, text), public.clear_batch(int),
  public.admin_remove_accepted(uuid), public.admin_reset_choice(uuid), public.admin_stats(),
  public.app_role(), public.faculty_has_student(uuid),
  public.cadre_seats(text), public.cadre_batches(text)
to authenticated;
