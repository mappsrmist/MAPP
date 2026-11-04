-- Assistant Professor (Jr.G) is a new cadre: 2 batches, 4 seats (same as HOD / Associate Chair).
-- Schema/function change only: no existing faculty row is modified, so current data is untouched.
-- A faculty member is moved to JR_G only by re-importing them or an explicit admin update.
alter table public.faculty drop constraint if exists faculty_cadre_check;
alter table public.faculty add constraint faculty_cadre_check
  check (cadre in ('HOD', 'ASSOC_CHAIR', 'JR_G', 'OTHER'));

create or replace function public.cadre_seats(p_cadre text)
returns int language sql immutable as $$
  select case p_cadre when 'HOD' then 4 when 'ASSOC_CHAIR' then 4 when 'JR_G' then 4 else 8 end
$$;
