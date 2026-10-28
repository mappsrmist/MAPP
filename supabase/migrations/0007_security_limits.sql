-- Atomic budgets shared across Vercel instances and direct authenticated RPC calls.
create table public.request_budgets (
  key text primary key,
  used integer not null,
  window_start timestamptz not null
);
alter table public.request_budgets enable row level security;
revoke all on public.request_budgets from public, anon, authenticated;

create function public.consume_request_budget(p_key text, p_limit integer, p_window integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_used integer; v_start timestamptz; v_now timestamptz := clock_timestamp();
begin
  if p_key is null or length(p_key) > 500 or p_limit < 1 or p_window not between 1 and 86400 then
    raise exception 'Invalid request budget.';
  end if;
  delete from public.request_budgets where window_start < v_now - interval '1 day';
  insert into public.request_budgets as b (key, used, window_start)
  values (p_key, 1, v_now)
  on conflict (key) do update set
    used = case when b.window_start <= v_now - make_interval(secs => p_window) then 1 else least(b.used + 1, p_limit + 1) end,
    window_start = case when b.window_start <= v_now - make_interval(secs => p_window) then v_now else b.window_start end
  returning used, window_start into v_used, v_start;
  if v_used > p_limit then
    return greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window) - v_now)))::integer);
  end if;
  return 0;
end $$;
revoke all on function public.consume_request_budget(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_request_budget(text, integer, integer) to service_role;

-- All public business RPCs call this helper, even when invoked outside Next.js.
-- Counts committed RPCs. Failed/rolled-back transactions cannot persist a counter;
-- provider-level limits remain required for invalid calls, table reads and Auth.
create or replace function public._assert_role(p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text; v_must boolean;
begin
  if auth.uid() is null then raise exception 'You are not signed in.' using errcode = '28000'; end if;
  select role, must_change_password into v_role, v_must from public.profiles where id = auth.uid();
  if v_role is distinct from p_role then raise exception 'You are not allowed to do this.' using errcode = '42501'; end if;
  if v_must then raise exception 'Please change your password before continuing.' using errcode = '42501'; end if;
  if public.consume_request_budget('rpc:' || auth.uid()::text, 120, 60) > 0 then
    raise sqlstate 'PGRST' using
      message = '{"code":"RATE_LIMITED","message":"Too many requests. Please wait a minute.","details":null,"hint":null}',
      detail = '{"status":429,"headers":{"Retry-After":"60"}}';
  end if;
end $$;
revoke all on function public._assert_role(text) from public, anon, authenticated;

-- PostgREST runs STABLE RPCs in read-only transactions even on POST. These read
-- RPCs now consume a budget, so expose them as VOLATILE and use POST (the JS
-- client's default). GET/HEAD RPC requests must not bypass budget consumption.
alter function public.list_faculty(text, text, integer) volatile;
alter function public.list_domains() volatile;
alter function public.get_faculty(uuid) volatile;
alter function public.my_minor_status() volatile;
alter function public.get_application() volatile;
alter function public.admin_stats() volatile;
notify pgrst, 'reload schema';
