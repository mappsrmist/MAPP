-- MAPP demo data: 1 HOD, 1 Associate Chair, 3 other faculty, 30 students.
-- Safe to re-run (existing usernames are skipped). Run in the Supabase SQL editor
-- (or `supabase db reset`, which applies migrations then this file).
--
-- Demo logins (all accounts must change their password on first login):
--   Students : username = registration number (e.g. RA2411003010001), password = same
--   Faculty  : username = SRM mail ID,         password = DOB as DDMMYYYY
-- The admin account is created by `npm run seed:admin` (password comes from ADMIN_INITIAL_PASSWORD).

create or replace function pg_temp.mk_user(p_email text, p_password text)
returns uuid language plpgsql set search_path = public, extensions as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now());
  return v_id;
end $$;

do $$
declare
  v_id uuid;
  f record;
  i int;
  v_reg text;
  v_names text[] := array[
    'Aarav Kumar','Diya Sharma','Vivaan Reddy','Ananya Iyer','Aditya Menon','Ishita Nair','Rohan Das','Meera Pillai',
    'Karthik Raj','Sneha Gupta','Arjun Verma','Pooja Singh','Rahul Joshi','Kavya Rao','Siddharth Jain','Nisha Patel',
    'Harini Subramanian','Yash Malhotra','Lakshmi Narayanan','Dev Chopra','Tanvi Kulkarni','Manoj Babu','Revathi S','Naveen Prasad',
    'Fatima Begum','Gokul Krishnan','Sanjana Bhat','Vignesh M','Aisha Khan','Prakash Raman'
  ];
  v_depts text[] := array['CSE','IT','CSE','ECE','CSE'];
begin
  -- ---------------------------------------------------------------- faculty
  for f in
    select * from (values
      ('E1001', 'Dr. Ramesh Kannan',  'ramesh.k@srmist.edu.in',  date '1972-03-14', 'Professor & Head',        'HOD',         '9840010001', 'TP 1001', array['Artificial Intelligence','Machine Learning']),
      ('E1002', 'Dr. Latha Sundaram', 'latha.s@srmist.edu.in',   date '1975-07-02', 'Associate Chair',         'ASSOC_CHAIR', '9840010002', 'TP 902',  array['Data Science','Big Data']),
      ('E1003', 'Dr. Priya Natarajan','priya.n@srmist.edu.in',   date '1982-11-23', 'Associate Professor',     'OTHER',       '9840010003', 'TP 804',  array['Cyber Security','Networks']),
      ('E1004', 'Dr. Vikram Anand',   'vikram.a@srmist.edu.in',  date '1985-01-09', 'Assistant Professor',     'OTHER',       '9840010004', 'TP 703',  array['Web Technologies','Cloud Computing']),
      ('E1005', 'Dr. Meenakshi R',    'meenakshi.r@srmist.edu.in', date '1988-09-30', 'Assistant Professor',   'OTHER',       '9840010005', 'TP 611',  array['Artificial Intelligence','Computer Vision'])
    ) as t(emp_id, name, srm_email, dob, designation, cadre, phone, venue, domains)
  loop
    continue when exists (select 1 from public.profiles where username = f.srm_email);
    v_id := pg_temp.mk_user(f.srm_email, to_char(f.dob, 'DDMMYYYY'));
    insert into public.profiles (id, role, username, must_change_password) values (v_id, 'faculty', f.srm_email, true);
    insert into public.faculty (id, emp_id, name, srm_email, dob, designation, cadre, phone, venue, domains)
    values (v_id, f.emp_id, f.name, f.srm_email, f.dob, f.designation, f.cadre, f.phone, f.venue, f.domains);
  end loop;

  -- ---------------------------------------------------------------- students
  for i in 1..30 loop
    v_reg := 'RA24110030100' || lpad(i::text, 2, '0');
    continue when exists (select 1 from public.profiles where username = v_reg);
    v_id := pg_temp.mk_user(lower(v_reg) || '@students.mapp.local', v_reg);
    insert into public.profiles (id, role, username, must_change_password) values (v_id, 'student', v_reg, true);
    insert into public.students (id, reg_no, name, dept, section, email)
    values (v_id, v_reg, v_names[i], v_depts[1 + (i % 5)], case when i % 2 = 0 then 'A' else 'B' end,
            lower(replace(v_names[i], ' ', '.')) || '@example.com');
  end loop;
end $$;
