-- MAPP v2: freeze controls + audit log, application form, per-student batch details,
-- ungroup, multi-domain faculty list, admin allocation actions.
-- Safe on a database that already holds v1 data (additive; legacy batch columns are dropped in 0006).

-- ------------------------------------------------------------- freeze + audit
create table public.system_settings (
  id int primary key default 1 check (id = 1), -- single row
  global_frozen boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.system_settings (id) values (1);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles (id) on delete set null,
  action text not null,
  scope text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

alter table public.faculty add column frozen boolean not null default false;

-- --------------------------------------------------------------- applications
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.faculty (id) on delete cascade,
  student1_id uuid not null references public.students (id) on delete cascade,
  student2_id uuid references public.students (id) on delete set null,
  student1_mail text,
  student1_mobile text,
  student2_reg text,
  student2_name text,
  student2_section text,
  student2_mail text,
  student2_mobile text,
  project_title text,
  sdg_goal text,
  problem_by_guide boolean,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_distinct_students check (student2_id is distinct from student1_id)
);
-- a student appears in at most one application
create unique index applications_student1_uq on public.applications (student1_id);
create unique index applications_student2_uq on public.applications (student2_id) where student2_id is not null;
create unique index applications_student2_reg_uq on public.applications (upper(student2_reg)) where student2_reg is not null;
create index applications_faculty_idx on public.applications (faculty_id);
create trigger applications_updated before update on public.applications
  for each row execute function public.set_updated_at();

create or replace function public.applications_check()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.applications a
    where a.id <> new.id and (a.student1_id = new.student2_id or a.student2_id = new.student1_id)
  ) then
    raise exception 'A student can be part of only one application.';
  end if;
  return new;
end $$;
create trigger applications_cross_check before insert or update on public.applications
  for each row execute function public.applications_check();

-- ----------------------------------------------------- per-student batch fields
-- Section / advisor / mail / contact now live on each batch member (B4).
alter table public.batch_members disable trigger batch_members_check;
alter table public.batch_members
  add column section text, add column advisor_name text, add column contact_number text, add column srm_mail text;
update public.batch_members m
  set section = b.section, advisor_name = b.advisor_name, contact_number = b.contact_number, srm_mail = b.srm_mail
  from public.batches b where b.id = m.batch_id;
alter table public.batch_members enable trigger batch_members_check;
alter table public.batch_members
  alter column section set not null, alter column advisor_name set not null,
  alter column contact_number set not null, alter column srm_mail set not null;
-- legacy columns are no longer written; they are dropped in 0006 once this is confirmed in production
alter table public.batches
  alter column section drop not null, alter column advisor_name drop not null,
  alter column contact_number drop not null, alter column srm_mail drop not null;

-- ------------------------------------------------------------------------ RLS
alter table public.system_settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.applications enable row level security;
revoke all on public.system_settings, public.audit_log, public.applications from anon, authenticated;
grant select on public.system_settings, public.audit_log, public.applications to authenticated;

create policy settings_select on public.system_settings
  for select to authenticated using (public.app_role() is not null);
create policy audit_select on public.audit_log
  for select to authenticated using (public.app_role() = 'admin');
create policy applications_select on public.applications for select to authenticated using (
  (public.app_role() = 'student' and (student1_id = auth.uid() or student2_id = auth.uid()))
  or (public.app_role() = 'faculty' and faculty_id = auth.uid())
  or public.app_role() = 'admin'
);

-- the browser can also watch these tables
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.system_settings;
    alter publication supabase_realtime add table public.batches;
    alter publication supabase_realtime add table public.students;
    alter publication supabase_realtime add table public.applications;
  end if;
end $$;

-- ----------------------------------------------------------------- helpers
-- Every allocation write calls this: global freeze, plus the faculty's own freeze when given.
create or replace function public._assert_open(p_faculty uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if (select global_frozen from public.system_settings where id = 1) then
    raise exception 'Allocations are frozen by the admin.' using errcode = '42501';
  end if;
  if p_faculty is not null and exists (select 1 from public.faculty where id = p_faculty and frozen) then
    raise exception 'Allocations for this faculty are frozen by the admin.' using errcode = '42501';
  end if;
end $$;

create or replace function public._audit(p_action text, p_scope text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, action, scope, details) values (auth.uid(), p_action, p_scope, p_details)
$$;

-- Human-readable who/what for audit entries (reg no and employee id, not just uuids).
create or replace function public._audit_alloc(p_student uuid, p_faculty uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'student_id', p_student,
    'reg_no', (select reg_no from public.students where id = p_student),
    'faculty_id', p_faculty,
    'emp_id', (select emp_id from public.faculty where id = p_faculty)))
$$;

-- Dissolve the team around a student: their batch and any application (guide changed / removed).
create or replace function public._dissolve_team(p_student uuid, p_type text default 'minor')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
begin
  select batch_id into v_batch from public.batch_members where student_id = p_student and project_type = p_type;
  if v_batch is not null then
    delete from public.batches where id = v_batch;
  end if;
  delete from public.applications where student1_id = p_student or student2_id = p_student;
end $$;

-- ------------------------------------------------- student RPCs honour freeze
create or replace function public.opt_mooc()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
begin
  perform public._assert_role('student');
  perform public._assert_open();
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

-- Faculty list: all domains, total + available seats; the domain filter matches ANY of a
-- faculty's domains (case-insensitive).
drop function public.list_faculty(text, text, int);
create function public.list_faculty(
  p_search text default null,
  p_domain text default null,
  p_page int default 1
)
returns table (
  id uuid, emp_id text, name text, designation text, domains text[],
  total_seats int, available_seats int, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_domain text := nullif(lower(trim(coalesce(p_domain, ''))), '');
begin
  perform public._assert_role('student');
  perform public._assert_minor_open();
  return query
    select f.id, f.emp_id, f.name, f.designation, f.domains, f.total_seats, f.available_seats, count(*) over ()
    from public.faculty f
    where f.available_seats > 0
      and (v_search is null or position(v_search in lower(f.name)) > 0 or position(v_search in lower(f.emp_id)) > 0)
      and (v_domain is null or exists (select 1 from unnest(f.domains) d where lower(trim(d)) = v_domain))
    order by f.name, f.emp_id
    limit 10 offset (v_page - 1) * 10;
end $$;

-- Distinct domains across faculty, case-normalised (one entry per lower-cased value).
create or replace function public.list_domains()
returns setof text language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_role('student');
  perform public._assert_minor_open();
  return query
    select x.d from (
      select distinct on (lower(trim(u))) trim(u) as d
      from public.faculty f, unnest(f.domains) as u
      where f.available_seats > 0 and trim(u) <> ''
      order by lower(trim(u)), trim(u)
    ) x order by lower(x.d);
end $$;

drop function public.my_minor_status();
create function public.my_minor_status()
returns table (
  request_id uuid, status text, faculty_id uuid, faculty_emp_id text, faculty_name text,
  designation text, phone text, venue text, domains text[], total_seats int, available_seats int,
  requested_at timestamptz, responded_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_role('student');
  return query
    select r.id, r.status, f.id, f.emp_id, f.name, f.designation, f.phone, f.venue, f.domains,
           f.total_seats, f.available_seats, r.created_at, r.responded_at
    from public.requests r join public.faculty f on f.id = r.faculty_id
    where r.student_id = auth.uid() and r.project_type = 'minor'
    order by r.created_at desc limit 1;
end $$;

-- ------------------------------------------------- faculty RPCs honour freeze
create or replace function public.respond_request(p_request_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
  v_count int;
  v_total int;
begin
  perform public._assert_role('faculty');
  perform public._assert_open(auth.uid());
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
    update public.students set choice = null, choice_at = null
      where id = v_req.student_id and choice = 'minor';
  end if;
end $$;

-- Group (or edit) a batch. p_members is an array of exactly two objects:
-- {student_id, section, advisor_name, contact_number, srm_mail} - one per student (B4).
drop function public.save_batch(int, uuid, uuid, text, text, text, text);
create function public.save_batch(p_batch_no int, p_members jsonb)
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

create or replace function public.clear_batch(p_batch_no int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_role('faculty');
  perform public._assert_open(auth.uid());
  delete from public.batches
    where faculty_id = auth.uid() and project_type = 'minor' and batch_no = p_batch_no;
end $$;

-- Ungroup: members go back to the unassigned pool and the batch details are cleared.
-- Accepted status and seats are untouched.
create function public.ungroup_batch(p_batch_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_role('faculty');
  perform public._assert_open(auth.uid());
  delete from public.batches where id = p_batch_id and faculty_id = auth.uid();
  if not found then raise exception 'Batch not found.'; end if;
end $$;

-- ----------------------------------------------------------- application form
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
  return v;
end $$;

create or replace function public._my_batch_partner()
returns uuid language sql stable security definer set search_path = public as $$
  select m2.student_id from public.batch_members m1
  join public.batch_members m2 on m2.batch_id = m1.batch_id and m2.slot <> m1.slot
  where m1.student_id = auth.uid() and m1.project_type = 'minor'
$$;

-- The caller's team application (their own, their partner's, or one that lists them) if any.
create or replace function public._team_application(p_partner uuid)
returns public.applications language sql stable security definer set search_path = public as $$
  select a.* from public.applications a
  where a.student1_id = auth.uid() or a.student2_id = auth.uid()
     or (p_partner is not null and (a.student1_id = p_partner or a.student2_id = p_partner))
  order by (a.student1_id = auth.uid() or a.student2_id = auth.uid()) desc
  limit 1
$$;

create function public.get_application()
returns table (
  application_id uuid, status text, faculty_id uuid, project_title text, sdg_goal text, problem_by_guide boolean,
  s1_name text, s1_reg text, s1_section text, s1_mail text, s1_mobile text,
  s2_name text, s2_reg text, s2_section text, s2_mail text, s2_mobile text, s2_locked boolean,
  guide_name text, guide_emp_id text, guide_phone text, can_edit boolean
)
language plpgsql stable security definer set search_path = public as $$
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
    g.name, g.emp_id, g.phone,
    (coalesce(v_app.status, 'draft') = 'draft' and not (select global_frozen from public.system_settings where id = 1));
end $$;

create function public.save_application(
  p_title text, p_sdg text, p_problem boolean,
  p_s1_mail text, p_s1_mobile text,
  p_s2_name text, p_s2_reg text, p_s2_section text, p_s2_mail text, p_s2_mobile text,
  p_submit boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fac uuid;
  v_partner uuid;
  v_app public.applications;
  v_s1 uuid;
  v_s2 uuid;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_sdg text := nullif(trim(coalesce(p_sdg, '')), '');
  v_m1 text := nullif(lower(trim(coalesce(p_s1_mail, ''))), '');
  v_t1 text := nullif(regexp_replace(coalesce(p_s1_mobile, ''), '[\s-]', '', 'g'), '');
  v_n2 text := nullif(trim(coalesce(p_s2_name, '')), '');
  v_r2 text := nullif(upper(trim(coalesce(p_s2_reg, ''))), '');
  v_c2 text := nullif(trim(coalesce(p_s2_section, '')), '');
  v_m2 text := nullif(lower(trim(coalesce(p_s2_mail, ''))), '');
  v_t2 text := nullif(regexp_replace(coalesce(p_s2_mobile, ''), '[\s-]', '', 'g'), '');
  p2 public.students;
  v_id uuid;
begin
  perform public._assert_role('student');
  perform public._assert_open();
  v_fac := public._my_accepted_faculty();
  perform pg_advisory_xact_lock(hashtext('mapp_applications'));
  v_partner := public._my_batch_partner();
  v_app := public._team_application(v_partner);

  if v_app.id is not null then
    if v_app.faculty_id <> v_fac then raise exception 'This application belongs to a different guide.'; end if;
    if v_app.status = 'submitted' then
      raise exception 'This application has been submitted and can no longer be edited.';
    end if;
    v_s1 := v_app.student1_id;
    v_s2 := coalesce(v_app.student2_id, case when v_app.student1_id = auth.uid() then v_partner
                                              when v_app.student1_id = v_partner then auth.uid() end);
  else
    v_s1 := auth.uid();
    v_s2 := v_partner;
  end if;

  -- field formats (checked whenever a value is given)
  if length(coalesce(v_title, '')) > 200 then raise exception 'Project title is too long.'; end if;
  if v_sdg is not null and (length(v_sdg) > 100 or v_sdg !~ '^(1[0-7]|[1-9])(\s*[.):-]\s*|\s+)\S') then
    raise exception 'SDG goal must start with a number from 1 to 17 followed by its name, e.g. 1. No Poverty.';
  end if;
  if v_m1 is not null and (length(v_m1) > 200 or v_m1 !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$') then
    raise exception 'Enter a valid SRM mail ID for Student 1.';
  end if;
  if v_t1 is not null and v_t1 !~ '^[0-9]{10}$' then raise exception 'Student 1 mobile number must be 10 digits.'; end if;
  if v_m2 is not null and (length(v_m2) > 200 or v_m2 !~ '^[a-z0-9._%+-]+@([a-z0-9-]+\.)*srmist\.edu\.in$') then
    raise exception 'Student 2 SRM mail ID must be an srmist.edu.in address.';
  end if;
  if v_t2 is not null and v_t2 !~ '^[0-9]{10}$' then raise exception 'Student 2 mobile number must be 10 digits.'; end if;

  if v_s2 is not null then
    -- a registered team mate (the faculty-formed batch partner): identity comes from the database
    select * into p2 from public.students where id = v_s2;
    v_n2 := p2.name; v_r2 := p2.reg_no; v_c2 := p2.section;
  else
    if v_r2 is not null and v_r2 !~ '^[A-Z0-9]{6,30}$' then raise exception 'Student 2 registration number is not valid.'; end if;
    if length(coalesce(v_n2, '')) > 100 or length(coalesce(v_c2, '')) > 20 then
      raise exception 'Student 2 name or section is too long.';
    end if;
    if v_r2 is not null and exists (select 1 from public.students where id = auth.uid() and upper(reg_no) = v_r2) then
      raise exception 'Student 2 cannot be you.';
    end if;
    if v_r2 is not null and exists (
      select 1 from public.applications a
      where a.id is distinct from v_app.id
        and (upper(a.student2_reg) = v_r2
             or a.student1_id in (select id from public.students where upper(reg_no) = v_r2)
             or a.student2_id in (select id from public.students where upper(reg_no) = v_r2))
    ) then
      raise exception 'Student 2 is already part of another application.';
    end if;
  end if;

  if p_submit then
    if v_title is null or v_sdg is null or p_problem is null or v_m1 is null or v_t1 is null
       or v_n2 is null or v_r2 is null or v_c2 is null or v_m2 is null or v_t2 is null then
      raise exception 'Fill in every field before submitting.';
    end if;
  end if;

  if v_app.id is null then
    insert into public.applications (
      faculty_id, student1_id, student2_id, student1_mail, student1_mobile,
      student2_reg, student2_name, student2_section, student2_mail, student2_mobile,
      project_title, sdg_goal, problem_by_guide, status
    ) values (
      v_fac, v_s1, v_s2, v_m1, v_t1, v_r2, v_n2, v_c2, v_m2, v_t2,
      v_title, v_sdg, p_problem, case when p_submit then 'submitted' else 'draft' end
    ) returning id into v_id;
  else
    update public.applications set
      student2_id = v_s2, student1_mail = v_m1, student1_mobile = v_t1,
      student2_reg = v_r2, student2_name = v_n2, student2_section = v_c2, student2_mail = v_m2, student2_mobile = v_t2,
      project_title = v_title, sdg_goal = v_sdg, problem_by_guide = p_problem,
      status = case when p_submit then 'submitted' else 'draft' end
    where id = v_app.id returning id into v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'A student can be part of only one application.';
end $$;

-- ----------------------------------------------------------------- admin RPCs
create function public.admin_set_global_freeze(p_frozen boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_role('admin');
  update public.system_settings set global_frozen = p_frozen, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._audit(case when p_frozen then 'freeze' else 'unfreeze' end, 'global');
end $$;

create function public.admin_set_faculty_freeze(p_faculty uuid, p_frozen boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp text;
begin
  perform public._assert_role('admin');
  update public.faculty set frozen = p_frozen where id = p_faculty returning emp_id into v_emp;
  if not found then raise exception 'Faculty not found.'; end if;
  perform public._audit(case when p_frozen then 'freeze' else 'unfreeze' end, 'faculty',
    jsonb_build_object('faculty_id', p_faculty, 'emp_id', v_emp, 'name', (select name from public.faculty where id = p_faculty)));
end $$;

create or replace function public.admin_remove_accepted(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
begin
  perform public._assert_role('admin');
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_req.status <> 'accepted' then raise exception 'Only accepted requests can be removed.'; end if;
  perform 1 from public.faculty where id = v_req.faculty_id for update;
  perform public._dissolve_team(v_req.student_id, v_req.project_type);
  update public.faculty set accepted_count = accepted_count - 1 where id = v_req.faculty_id;
  update public.requests set status = 'declined', responded_at = now() where id = p_request_id;
  update public.students set choice = null, choice_at = null where id = v_req.student_id and choice = 'minor';
  perform public._audit('remove_allocation', 'allocation', public._audit_alloc(v_req.student_id, v_req.faculty_id));
end $$;

create function public.admin_set_section(p_student uuid, p_section text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v text := trim(coalesce(p_section, ''));
begin
  perform public._assert_role('admin');
  if v = '' or length(v) > 20 then raise exception 'Enter a section (up to 20 characters).'; end if;
  update public.students set section = v where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
  update public.batch_members set section = v where student_id = p_student;
  perform public._audit('edit_section', 'allocation', public._audit_alloc(p_student, null) || jsonb_build_object('section', v));
end $$;

-- Move an accepted student to another faculty (needs a free seat there). The old batch and any
-- application are dissolved because the guide changes.
create function public.admin_move_student(p_request_id uuid, p_to_faculty uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests%rowtype;
  v_count int;
  v_total int;
begin
  perform public._assert_role('admin');
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_req.status <> 'accepted' then raise exception 'Only accepted students can be moved.'; end if;
  if v_req.faculty_id = p_to_faculty then raise exception 'The student is already with this faculty.'; end if;
  perform 1 from public.faculty where id in (v_req.faculty_id, p_to_faculty) order by id for update;
  select accepted_count, total_seats into v_count, v_total from public.faculty where id = p_to_faculty;
  if not found then raise exception 'Faculty not found.'; end if;
  if v_count >= v_total then raise exception 'The selected faculty has no available seats.'; end if;
  perform public._dissolve_team(v_req.student_id, v_req.project_type);
  update public.faculty set accepted_count = accepted_count - 1 where id = v_req.faculty_id;
  update public.faculty set accepted_count = accepted_count + 1 where id = p_to_faculty;
  update public.requests set faculty_id = p_to_faculty, responded_at = now() where id = p_request_id;
  perform public._audit('move_student', 'allocation',
    public._audit_alloc(v_req.student_id, v_req.faculty_id) || jsonb_build_object('to_emp_id', (select emp_id from public.faculty where id = p_to_faculty)));
end $$;

-- Reset a request back to Pending (from Accepted: frees the seat; from Declined: re-locks the student).
create function public.admin_reset_request(p_request_id uuid)
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
    if v_choice = 'mooc' then raise exception 'The student has opted for MOOC. Undo that first.'; end if;
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

create function public.admin_set_application_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_role('admin');
  if p_status not in ('draft', 'submitted') then raise exception 'Invalid status.'; end if;
  update public.applications set status = p_status where id = p_id;
  if not found then raise exception 'Application not found.'; end if;
  perform public._audit('application_status', 'application', jsonb_build_object('application_id', p_id, 'status', p_status));
end $$;

-- ------------------------------------------------------ allocation view (v2)
drop view public.request_details_v;
create view public.request_details_v with (security_invoker = true) as
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
  case r.status when 'pending' then 0 when 'accepted' then 1 else 2 end as status_rank
from public.requests r
join public.faculty f on f.id = r.faculty_id
join public.students s on s.id = r.student_id
left join public.batch_members bm
  on bm.student_id = r.student_id and bm.project_type = r.project_type and r.status = 'accepted'
left join public.batches b on b.id = bm.batch_id and b.faculty_id = r.faculty_id;

revoke all on public.request_details_v from anon, authenticated;
grant select on public.request_details_v to authenticated;

-- ------------------------------------------------------------- privileges
revoke execute on function
  public._assert_open(uuid), public._audit(text, text, jsonb), public._dissolve_team(uuid, text),
  public._audit_alloc(uuid, uuid), public._my_accepted_faculty(), public._my_batch_partner(), public._team_application(uuid),
  public.applications_check()
from public, anon, authenticated;

revoke execute on function
  public.list_faculty(text, text, int), public.my_minor_status(), public.opt_mooc(),
  public.submit_request(uuid), public.respond_request(uuid, text), public.list_domains(),
  public.save_batch(int, jsonb), public.clear_batch(int), public.ungroup_batch(uuid),
  public.get_application(),
  public.save_application(text, text, boolean, text, text, text, text, text, text, text, boolean),
  public.admin_set_global_freeze(boolean), public.admin_set_faculty_freeze(uuid, boolean),
  public.admin_remove_accepted(uuid), public.admin_set_section(uuid, text),
  public.admin_move_student(uuid, uuid), public.admin_reset_request(uuid),
  public.admin_set_application_status(uuid, text)
from public, anon;
grant execute on function
  public.list_faculty(text, text, int), public.my_minor_status(), public.opt_mooc(),
  public.submit_request(uuid), public.respond_request(uuid, text), public.list_domains(),
  public.save_batch(int, jsonb), public.clear_batch(int), public.ungroup_batch(uuid),
  public.get_application(),
  public.save_application(text, text, boolean, text, text, text, text, text, text, text, boolean),
  public.admin_set_global_freeze(boolean), public.admin_set_faculty_freeze(uuid, boolean),
  public.admin_remove_accepted(uuid), public.admin_set_section(uuid, text),
  public.admin_move_student(uuid, uuid), public.admin_reset_request(uuid),
  public.admin_set_application_status(uuid, text)
to authenticated;
