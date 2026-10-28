-- Production hardening.
--  1. Initial passwords are now random one-time values, so the faculty date of birth is no
--     longer needed (and is no longer stored).
--  2. Login / password-change throttling that does not depend on the caller's IP alone.
--  3. Length caps on free-text batch fields.

-- ------------------------------------------------------------------- dob
alter table public.faculty drop column if exists dob;

-- ---------------------------------------------------------- throttling
-- Written only by the service-role login/password route handlers. No client access at all.
create table if not exists public.auth_throttle (
  key text primary key,
  fails int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
create index if not exists auth_throttle_window_idx on public.auth_throttle (window_start);
alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from public, anon, authenticated;

-- Seconds left on an active lock for this key (0 = not locked).
create or replace function public.throttle_blocked(p_key text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select greatest(ceil(extract(epoch from (locked_until - now())))::int, 0)
       from public.auth_throttle where key = p_key and locked_until > now()),
    0)
$$;

-- Records a failure. After p_max failures inside p_window_secs the key is locked for p_lock_secs.
create or replace function public.throttle_fail(p_key text, p_max int, p_window_secs int, p_lock_secs int)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.auth_throttle
    where window_start < now() - interval '1 day' and (locked_until is null or locked_until < now());
  insert into public.auth_throttle as t (key, fails, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    fails = case when t.window_start < now() - make_interval(secs => p_window_secs) then 1 else t.fails + 1 end,
    window_start = case when t.window_start < now() - make_interval(secs => p_window_secs) then now() else t.window_start end,
    locked_until = case
      when (case when t.window_start < now() - make_interval(secs => p_window_secs) then 1 else t.fails + 1 end) >= p_max
        then now() + make_interval(secs => p_lock_secs)
      else t.locked_until end;
end $$;

create or replace function public.throttle_clear(p_key text)
returns void language sql security definer set search_path = public as $$
  delete from public.auth_throttle where key = p_key
$$;

revoke execute on function public.throttle_blocked(text), public.throttle_fail(text, int, int, int),
  public.throttle_clear(text) from public, anon, authenticated;
grant execute on function public.throttle_blocked(text), public.throttle_fail(text, int, int, int),
  public.throttle_clear(text) to service_role;

-- ------------------------------------------------------ batch field caps
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
  if length(trim(p_section)) > 20 or length(trim(p_advisor)) > 100 then
    raise exception 'Section or Faculty Advisor Name is too long.';
  end if;
  if p_contact !~ '^\+?[0-9]{10,13}$' then
    raise exception 'Enter a valid contact number.';
  end if;
  if length(p_mail) > 200 or p_mail !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
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

revoke execute on function public.save_batch(int, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.save_batch(int, uuid, uuid, text, text, text, text) to authenticated;
