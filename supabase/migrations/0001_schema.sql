-- MAPP schema: tables, constraints, triggers.
-- Seat/batch rules by cadre live in ONE place (cadre_seats / cadre_batches).

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- HOD 6 seats / 3 batches, Associate Chair 4 / 2, everyone else 8 / 4. One batch = 2 students.
create or replace function public.cadre_seats(p_cadre text)
returns int language sql immutable as $$
  select case p_cadre when 'HOD' then 6 when 'ASSOC_CHAIR' then 4 else 8 end
$$;

create or replace function public.cadre_batches(p_cadre text)
returns int language sql immutable as $$
  select public.cadre_seats(p_cadre) / 2
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('student', 'faculty', 'admin')),
  username text not null unique,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- students
-- students.choice is the single source of truth for the MOOC / Minor decision.
create table public.students (
  id uuid primary key references public.profiles (id) on delete cascade,
  reg_no text not null unique,
  name text not null,
  dept text not null,
  section text,
  email text,
  choice text check (choice in ('mooc', 'minor')),
  choice_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_name_idx on public.students (lower(name));
create index students_choice_idx on public.students (choice);
create trigger students_updated before update on public.students
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- faculty
create table public.faculty (
  id uuid primary key references public.profiles (id) on delete cascade,
  emp_id text not null unique,
  name text not null,
  srm_email text not null unique,
  dob date,
  designation text not null,
  cadre text not null check (cadre in ('HOD', 'ASSOC_CHAIR', 'OTHER')),
  phone text,
  venue text,
  domains text[] not null default '{}',
  total_seats int not null default 8,
  accepted_count int not null default 0,
  available_seats int generated always as (total_seats - accepted_count) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faculty_seats_valid check (accepted_count >= 0 and accepted_count <= total_seats)
);
create index faculty_available_idx on public.faculty (available_seats);
create index faculty_domains_idx on public.faculty using gin (domains);

create or replace function public.faculty_set_seats()
returns trigger language plpgsql as $$
begin
  new.total_seats := public.cadre_seats(new.cadre);
  return new;
end $$;
create trigger faculty_seats before insert or update of cadre on public.faculty
  for each row execute function public.faculty_set_seats();
create trigger faculty_updated before update on public.faculty
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- requests
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  faculty_id uuid not null references public.faculty (id) on delete cascade,
  project_type text not null default 'minor' check (project_type in ('minor', 'major')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now()
);
-- ONE STUDENT = ONE ACTIVE REQUEST (per project type). Enforced by the database.
create unique index requests_one_active_per_student
  on public.requests (student_id, project_type)
  where status in ('pending', 'accepted');
create index requests_faculty_idx on public.requests (faculty_id, status);
create index requests_student_idx on public.requests (student_id, created_at desc);
create trigger requests_updated before update on public.requests
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- batches
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.faculty (id) on delete cascade,
  project_type text not null default 'minor' check (project_type in ('minor', 'major')),
  batch_no int not null check (batch_no between 1 and 4),
  section text not null,
  advisor_name text not null,
  contact_number text not null,
  srm_mail text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (faculty_id, project_type, batch_no)
);
create trigger batches_updated before update on public.batches
  for each row execute function public.set_updated_at();

create table public.batch_members (
  batch_id uuid not null references public.batches (id) on delete cascade,
  slot int not null check (slot in (1, 2)),
  student_id uuid not null references public.students (id) on delete cascade,
  project_type text not null default 'minor',
  primary key (batch_id, slot),
  -- a student sits in at most one batch
  unique (student_id, project_type)
);

-- A batch member must hold an ACCEPTED request with the batch's faculty.
create or replace function public.batch_member_check()
returns trigger language plpgsql as $$
declare
  v_faculty uuid;
  v_type text;
begin
  select faculty_id, project_type into v_faculty, v_type from public.batches where id = new.batch_id;
  new.project_type := v_type;
  if not exists (
    select 1 from public.requests
    where student_id = new.student_id and faculty_id = v_faculty
      and project_type = v_type and status = 'accepted'
  ) then
    raise exception 'Student has no accepted request with this faculty.';
  end if;
  return new;
end $$;
create trigger batch_members_check before insert or update on public.batch_members
  for each row execute function public.batch_member_check();
