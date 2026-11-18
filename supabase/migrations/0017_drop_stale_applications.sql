-- An application form belongs to one team. Faculty can ungroup / regroup students, which changes the batch but used to
-- leave the old application behind. A student regrouped with someone who already had an application (with a third
-- student) was then shown that stale form: their own slot held the former team mate's name.
--
-- _team_application now removes applications whose two registered students no longer match the caller's current
-- batch partner, before looking the application up. Both get_application() and save_application() call it.
-- Applications where the second student is still a manually typed (unregistered) person are untouched.

create or replace function public._team_application(p_partner uuid)
returns public.applications language plpgsql volatile security definer set search_path = public as $$
declare
  v_app public.applications;
begin
  if p_partner is not null then
    delete from public.applications a
    where (a.student1_id = auth.uid() and a.student2_id is not null and a.student2_id <> p_partner)
       or (a.student2_id = auth.uid() and a.student1_id <> p_partner)
       or (a.student1_id = p_partner and a.student2_id is not null and a.student2_id <> auth.uid())
       or (a.student2_id = p_partner and a.student1_id <> auth.uid());
  end if;

  select a.* into v_app from public.applications a
  where a.student1_id = auth.uid() or a.student2_id = auth.uid()
     or (p_partner is not null and (a.student1_id = p_partner or a.student2_id = p_partner))
  order by (a.student1_id = auth.uid() or a.student2_id = auth.uid()) desc
  limit 1;
  return v_app;
end $$;

revoke execute on function public._team_application(uuid) from public, anon, authenticated;
