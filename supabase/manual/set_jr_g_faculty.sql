-- MANUAL, one-off data change (NOT a migration; do not put this in supabase/migrations).
-- Run 0015_jr_g_two_batches.sql FIRST. Then run STEP 1 alone to preview, then STEP 2.
-- Only faculty.cadre of the 33 listed employee IDs changes (the seat trigger then sets total_seats = 4).
-- No student, application, batch or accepted-count row is touched.

-- ===== STEP 1: PREVIEW (read-only) =====
with ids(emp_id) as (values
  ('103191'),('103194'),('103314'),('103323'),('103352'),('103355'),('103357'),('103358'),('103577'),
  ('103610'),('103611'),('103612'),('103614'),('103616'),('103623'),('103624'),('103627'),('103628'),
  ('103635'),('103656'),('103657'),('103662'),('103673'),('103709'),('102440'),('103738'),('103739'),
  ('103746'),('103750'),('103812'),('103813'),('103824'),('103835'))
select i.emp_id, f.name, f.cadre, f.total_seats, f.accepted_count,
       (select max(b.batch_no) from public.batches b where b.faculty_id = f.id) as max_batch_no,
       case when f.id is null then 'NOT FOUND' end as problem
from ids i left join public.faculty f on f.emp_id = i.emp_id
order by problem nulls last, i.emp_id;

-- ===== STEP 2: APPLY (all-or-nothing; aborts without changing anything if a guard fails) =====
begin;

do $$
declare
  v_ids text[] := array['103191','103194','103314','103323','103352','103355','103357','103358','103577',
    '103610','103611','103612','103614','103616','103623','103624','103627','103628','103635','103656',
    '103657','103662','103673','103709','102440','103738','103739','103746','103750','103812','103813',
    '103824','103835'];
  v_found int;
  v_bad text;
begin
  select count(*) into v_found from public.faculty where emp_id = any(v_ids);
  if v_found <> array_length(v_ids, 1) then
    raise exception 'Only % of % employee IDs exist in faculty; check the preview for NOT FOUND rows.', v_found, array_length(v_ids, 1);
  end if;

  select string_agg(emp_id || ' (' || cadre || ')', ', ') into v_bad
    from public.faculty where emp_id = any(v_ids) and cadre not in ('OTHER', 'JR_G');
  if v_bad is not null then
    raise exception 'These are HOD / Associate Chair, not regular faculty: %', v_bad;
  end if;

  select string_agg(f.emp_id, ', ') into v_bad
    from public.faculty f
   where f.emp_id = any(v_ids)
     and (f.accepted_count > 4
          or exists (select 1 from public.batches b where b.faculty_id = f.id and b.batch_no > 2));
  if v_bad is not null then
    raise exception 'Over the new limit (more than 4 accepted students or a batch above 2): %', v_bad;
  end if;

  update public.faculty set cadre = 'JR_G' where emp_id = any(v_ids) and cadre <> 'JR_G';
end $$;

commit;
