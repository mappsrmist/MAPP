-- MANUAL, one-off data change (NOT a migration; do not put this in supabase/migrations).
-- Run 0015_jr_g_two_batches.sql FIRST. Then run STEP 1 alone to preview, then STEP 2.
--
-- For the 33 listed employee IDs, STEP 2:
--   * sets faculty.cadre = 'JR_G' (the seat trigger then sets total_seats = 4);
--   * if a faculty member is OVER the new limit (more than 4 accepted students, or any batch numbered
--     above 2), ALL of their accepted students are released: their batches and applications are deleted,
--     their accepted request is deleted, and the student's choice is reset so they can apply again to the
--     same faculty or to anyone else. accepted_count is brought back in step.
--   * faculty at or under the limit are not touched except for the cadre change.
-- Students of other faculty, pending requests, MOOC/exempt students and all other tables are untouched.

-- ===== STEP 1: PREVIEW (read-only) =====
with ids(emp_id) as (values
  ('103191'),('103194'),('103314'),('103323'),('103352'),('103355'),('103357'),('103358'),('103577'),
  ('103610'),('103611'),('103612'),('103614'),('103616'),('103623'),('103624'),('103627'),('103628'),
  ('103635'),('103656'),('103657'),('103662'),('103673'),('103709'),('102440'),('103738'),('103739'),
  ('103746'),('103750'),('103812'),('103813'),('103824'),('103835'))
select i.emp_id, f.name, f.cadre, f.total_seats, f.accepted_count,
       (select max(b.batch_no) from public.batches b where b.faculty_id = f.id) as max_batch_no,
       case
         when f.id is null then 'NOT FOUND'
         when f.cadre not in ('OTHER', 'JR_G') then 'HOD / ASSOC CHAIR - will abort'
         when f.accepted_count > 4
           or exists (select 1 from public.batches b where b.faculty_id = f.id and b.batch_no > 2)
           then 'OVER LIMIT - all accepted students will be released'
       end as action
from ids i left join public.faculty f on f.emp_id = i.emp_id
order by (case when f.id is null then 0 when f.cadre not in ('OTHER', 'JR_G') then 1
               when f.accepted_count > 4 or exists (select 1 from public.batches b where b.faculty_id = f.id and b.batch_no > 2) then 2
               else 3 end), i.emp_id;

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
  f record;
  r record;
  v_released int;
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

  -- release every accepted student of each over-limit faculty
  for f in
    select fa.id, fa.emp_id from public.faculty fa
     where fa.emp_id = any(v_ids)
       and (fa.accepted_count > 4
            or exists (select 1 from public.batches b where b.faculty_id = fa.id and b.batch_no > 2))
     order by fa.emp_id
  loop
    perform 1 from public.faculty where id = f.id for update;
    v_released := 0;
    for r in
      select id, student_id, project_type from public.requests
       where faculty_id = f.id and status = 'accepted'
    loop
      perform public._dissolve_team(r.student_id, r.project_type);   -- batch + application(s)
      delete from public.requests where id = r.id;                   -- so they can re-apply, even to the same faculty
      update public.students set choice = null, choice_at = null
       where id = r.student_id and choice = 'minor';                 -- back to "not opted"
      v_released := v_released + 1;
    end loop;
    -- any application or batch still hanging on this faculty (e.g. a draft with no accepted request)
    delete from public.applications where faculty_id = f.id;
    delete from public.batches where faculty_id = f.id;
    update public.faculty
       set accepted_count = (select count(*) from public.requests where faculty_id = f.id and status = 'accepted')
     where id = f.id;
    insert into public.audit_log (actor, action, scope, details)
      values (null, 'jr_g_release_all', 'faculty',
              jsonb_build_object('faculty_id', f.id, 'emp_id', f.emp_id, 'students_released', v_released));
    raise notice 'Released % accepted student(s) of faculty %', v_released, f.emp_id;
  end loop;

  update public.faculty set cadre = 'JR_G' where emp_id = any(v_ids) and cadre <> 'JR_G';
end $$;

-- RESULT: the faculty whose students were released in this run (now() = start of this transaction)
select a.details->>'emp_id' as emp_id, f.name, (a.details->>'students_released')::int as students_released
from public.audit_log a
left join public.faculty f on f.id = (a.details->>'faculty_id')::uuid
where a.action = 'jr_g_release_all' and a.created_at >= now()
order by emp_id;

commit;
