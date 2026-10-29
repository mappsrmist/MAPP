-- Add project classification and restore optional guide designation.
-- Apply before deploying the updated application client.
alter table public.applications add column project_type text
  check (project_type in ('research', 'product', 'multidisciplinary'));
alter table public.faculty add column designation text check (length(designation) <= 200);

drop function public.get_application();
create function public.get_application()
returns table (
  application_id uuid, status text, faculty_id uuid, project_title text, project_type text, sdg_goal text, problem_by_guide boolean,
  s1_name text, s1_reg text, s1_section text, s1_mail text, s1_mobile text,
  s2_name text, s2_reg text, s2_section text, s2_mail text, s2_mobile text, s2_locked boolean,
  guide_name text, guide_emp_id text, guide_phone text, guide_department text, guide_designation text, can_edit boolean
)
language plpgsql volatile security definer set search_path = public as $$
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
    v_app.id, coalesce(v_app.status, 'draft'), v_fac, v_app.project_title, v_app.project_type, v_app.sdg_goal, v_app.problem_by_guide,
    a.name, a.reg_no, a.section, coalesce(v_app.student1_mail, a.email), v_app.student1_mobile,
    coalesce(b.name, v_app.student2_name), coalesce(b.reg_no, v_app.student2_reg),
    coalesce(b.section, v_app.student2_section),
    coalesce(v_app.student2_mail, b.email), v_app.student2_mobile, (v_s2 is not null),
    g.name, g.emp_id, g.phone, g.department, g.designation,
    (coalesce(v_app.status, 'draft') = 'draft' and not (select global_frozen from public.system_settings where id = 1));
end $$;


-- Replace the old signature to avoid ambiguous PostgREST overloads.
drop function public.save_application(text, text, boolean, text, text, text, text, text, text, text, boolean);
create function public.save_application(
  p_title text, p_sdg text, p_problem boolean,
  p_s1_mail text, p_s1_mobile text,
  p_s2_name text, p_s2_reg text, p_s2_section text, p_s2_mail text, p_s2_mobile text,
  p_submit boolean default false, p_project_type text default null
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

  if p_project_type is not null and p_project_type not in ('research', 'product', 'multidisciplinary') then
    raise exception 'Select a valid project type.';
  end if;
  if p_submit and p_project_type is null then raise exception 'Select a project type before submitting.'; end if;

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
      project_title, sdg_goal, problem_by_guide, project_type, status
    ) values (
      v_fac, v_s1, v_s2, v_m1, v_t1, v_r2, v_n2, v_c2, v_m2, v_t2,
      v_title, v_sdg, p_problem, p_project_type, case when p_submit then 'submitted' else 'draft' end
    ) returning id into v_id;
  else
    update public.applications set
      student2_id = v_s2, student1_mail = v_m1, student1_mobile = v_t1,
      student2_reg = v_r2, student2_name = v_n2, student2_section = v_c2, student2_mail = v_m2, student2_mobile = v_t2,
      project_title = v_title, sdg_goal = v_sdg, problem_by_guide = p_problem, project_type = p_project_type,
      status = case when p_submit then 'submitted' else 'draft' end
    where id = v_app.id returning id into v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'A student can be part of only one application.';
end $$;


revoke all on function public.get_application() from public, anon;
grant execute on function public.get_application() to authenticated;
revoke all on function public.save_application(text, text, boolean, text, text, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.save_application(text, text, boolean, text, text, text, text, text, text, text, boolean, text) to authenticated;
