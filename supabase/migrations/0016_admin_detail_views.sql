-- Admin-only drill-down: everything the portal knows about one student or one faculty member.
-- Read-only; both functions assert the admin role.

create or replace function public.admin_student_detail(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public._assert_role('admin');
  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', s.id, 'reg_no', s.reg_no, 'name', s.name, 'dept', s.dept, 'section', public._norm_section(s.section),
      'email', s.email, 'choice', s.choice, 'choice_at', s.choice_at, 'mooc_cgpa', s.mooc_cgpa,
      'is_active', s.is_active, 'exempt_reason', s.exempt_reason, 'created_at', s.created_at,
      'username', (select p.username from public.profiles p where p.id = s.id)),
    'advisor', (select jsonb_build_object('id', f.id, 'emp_id', f.emp_id, 'name', f.name, 'srm_email', f.srm_email, 'phone', f.phone, 'venue', f.venue)
                from public.faculty f where f.id = s.fa_id),
    'mooc_requests', coalesce((select jsonb_agg(jsonb_build_object('status', m.status, 'cgpa', m.cgpa, 'requested_at', m.requested_at, 'reviewed_at', m.reviewed_at)
                                                order by m.requested_at desc)
                               from public.mooc_requests m where m.student_id = s.id), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'status', r.status, 'created_at', r.created_at, 'responded_at', r.responded_at,
                  'faculty_id', f.id, 'faculty_emp_id', f.emp_id, 'faculty_name', f.name, 'faculty_email', f.srm_email,
                  'faculty_phone', f.phone, 'faculty_venue', f.venue, 'faculty_domains', f.domains) order by r.created_at desc)
                from public.requests r join public.faculty f on f.id = r.faculty_id
                where r.student_id = s.id and r.project_type = 'minor'), '[]'::jsonb),
    'batch', (select jsonb_build_object(
                'id', b.id, 'batch_no', b.batch_no, 'faculty_emp_id', f.emp_id, 'faculty_name', f.name,
                'members', (select jsonb_agg(jsonb_build_object(
                              'slot', bm2.slot, 'student_id', s2.id, 'reg_no', s2.reg_no, 'name', s2.name,
                              'section', bm2.section, 'advisor_name', bm2.advisor_name,
                              'contact_number', bm2.contact_number, 'srm_mail', bm2.srm_mail) order by bm2.slot)
                            from public.batch_members bm2 join public.students s2 on s2.id = bm2.student_id
                            where bm2.batch_id = b.id))
              from public.batch_members bm
              join public.batches b on b.id = bm.batch_id
              join public.faculty f on f.id = b.faculty_id
              where bm.student_id = s.id and bm.project_type = 'minor' limit 1),
    'application', (select jsonb_build_object(
                'id', a.id, 'status', a.status, 'project_title', a.project_title, 'project_type', a.project_type,
                'sdg_goal', a.sdg_goal, 'problem_by_guide', a.problem_by_guide, 'updated_at', a.updated_at,
                'guide_emp_id', f.emp_id, 'guide_name', f.name,
                's1_id', a.student1_id, 's1_name', s1.name, 's1_reg', s1.reg_no, 's1_section', s1.section,
                's1_mail', coalesce(a.student1_mail, s1.email), 's1_mobile', a.student1_mobile,
                's2_id', a.student2_id, 's2_name', coalesce(s2.name, a.student2_name), 's2_reg', coalesce(s2.reg_no, a.student2_reg),
                's2_section', coalesce(s2.section, a.student2_section), 's2_mail', coalesce(a.student2_mail, s2.email), 's2_mobile', a.student2_mobile)
              from public.applications a
              join public.faculty f on f.id = a.faculty_id
              join public.students s1 on s1.id = a.student1_id
              left join public.students s2 on s2.id = a.student2_id
              where s.id in (a.student1_id, a.student2_id) limit 1)
  ) into v
  from public.students s where s.id = p_student;
  if v is null then raise exception 'Student not found.'; end if;
  return v;
end $$;

create or replace function public.admin_faculty_detail(p_faculty uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public._assert_role('admin');
  select jsonb_build_object(
    'faculty', jsonb_build_object(
      'id', f.id, 'emp_id', f.emp_id, 'name', f.name, 'srm_email', f.srm_email, 'phone', f.phone, 'venue', f.venue,
      'department', f.department, 'designation', f.designation, 'cadre', f.cadre, 'domains', f.domains,
      'total_seats', f.total_seats, 'accepted_count', f.accepted_count, 'available_seats', f.available_seats,
      'frozen', f.frozen, 'username', (select p.username from public.profiles p where p.id = f.id)),
    'batches', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', b.id, 'batch_no', b.batch_no,
                  'members', (select jsonb_agg(jsonb_build_object(
                                'slot', bm.slot, 'student_id', s.id, 'reg_no', s.reg_no, 'name', s.name,
                                'section', bm.section, 'advisor_name', bm.advisor_name,
                                'contact_number', bm.contact_number, 'srm_mail', bm.srm_mail) order by bm.slot)
                              from public.batch_members bm join public.students s on s.id = bm.student_id
                              where bm.batch_id = b.id),
                  'application', (select jsonb_build_object(
                                'status', a.status, 'project_title', a.project_title, 'project_type', a.project_type,
                                'sdg_goal', a.sdg_goal, 'problem_by_guide', a.problem_by_guide,
                                's1_mobile', a.student1_mobile, 's2_mobile', a.student2_mobile)
                              from public.applications a
                              where a.faculty_id = f.id
                                and (a.student1_id in (select student_id from public.batch_members where batch_id = b.id)
                                  or a.student2_id in (select student_id from public.batch_members where batch_id = b.id))
                              limit 1)
                ) order by b.batch_no)
                from public.batches b where b.faculty_id = f.id and b.project_type = 'minor'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'status', r.status, 'created_at', r.created_at, 'responded_at', r.responded_at,
                  'student_id', s.id, 'reg_no', s.reg_no, 'name', s.name, 'section', public._norm_section(s.section), 'email', s.email,
                  'grouped', exists (select 1 from public.batch_members bm where bm.student_id = s.id and bm.project_type = 'minor'),
                  'project_title', (select a.project_title from public.applications a where a.faculty_id = f.id and s.id in (a.student1_id, a.student2_id) limit 1))
                  order by (r.status = 'accepted') desc, (r.status = 'pending') desc, r.created_at desc)
                from public.requests r join public.students s on s.id = r.student_id
                where r.faculty_id = f.id and r.project_type = 'minor' and s.is_active), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', a.id, 'status', a.status, 'project_title', a.project_title, 'project_type', a.project_type,
                  'sdg_goal', a.sdg_goal, 'problem_by_guide', a.problem_by_guide,
                  's1_name', s1.name, 's1_reg', s1.reg_no, 's1_mail', coalesce(a.student1_mail, s1.email), 's1_mobile', a.student1_mobile,
                  's2_name', coalesce(s2.name, a.student2_name), 's2_reg', coalesce(s2.reg_no, a.student2_reg),
                  's2_mail', coalesce(a.student2_mail, s2.email), 's2_mobile', a.student2_mobile) order by a.created_at)
                from public.applications a
                join public.students s1 on s1.id = a.student1_id
                left join public.students s2 on s2.id = a.student2_id
                where a.faculty_id = f.id), '[]'::jsonb),
    'advisees', coalesce((select jsonb_agg(jsonb_build_object(
                  'student_id', s.id, 'reg_no', s.reg_no, 'name', s.name, 'section', public._norm_section(s.section),
                  'email', s.email, 'status', public._student_status(s.choice)) order by s.reg_no)
                from public.students s where s.fa_id = f.id and s.is_active), '[]'::jsonb)
  ) into v
  from public.faculty f where f.id = p_faculty;
  if v is null then raise exception 'Faculty not found.'; end if;
  return v;
end $$;

revoke all on function public.admin_student_detail(uuid), public.admin_faculty_detail(uuid) from public, anon;
grant execute on function public.admin_student_detail(uuid), public.admin_faculty_detail(uuid) to authenticated;
notify pgrst, 'reload schema';
