-- HOD now gets 2 batches (4 seats), the same as Associate Chair. Everyone else stays 8 / 4.
create or replace function public.cadre_seats(p_cadre text)
returns int language sql immutable as $$
  select case p_cadre when 'HOD' then 4 when 'ASSOC_CHAIR' then 4 else 8 end
$$;

do $$
begin
  if exists (select 1 from public.faculty where cadre = 'HOD' and accepted_count > 4) then
    raise exception 'An HOD has more than 4 accepted students; remove the extras before applying this migration.';
  end if;
  if exists (select 1 from public.batches b join public.faculty f on f.id = b.faculty_id where f.cadre = 'HOD' and b.batch_no > 2) then
    raise exception 'An HOD has a batch numbered above 2; regroup those students before applying this migration.';
  end if;
end $$;

-- Re-fire faculty_set_seats so existing HOD rows pick up the new total.
update public.faculty set cadre = cadre where cadre = 'HOD';
