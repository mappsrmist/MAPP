-- Apply after the v3 app is deployed: nothing reads faculty.designation any more.
-- `cadre` stays (it drives seat and batch counts); it is just never displayed.
alter table public.faculty drop column designation;
notify pgrst, 'reload schema';
