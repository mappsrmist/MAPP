-- PERFORMANCE FIX. Not applied automatically: review, then run once in the Supabase SQL editor.
-- SAFE FOR DATA: adds one index and replaces one helper function. It does not read, change or delete
-- any student, faculty, request, batch or application data. Rate-limit counters keep working as before.
--
-- Problem: consume_request_budget() runs on every student RPC and every login. It did
--   delete from request_budgets where window_start < now() - 1 day
-- on EVERY call, with no index (full table scan + write each time).
-- Fix: index the column, and run that clean-up on ~1% of calls instead of all of them.

create index if not exists request_budgets_window_idx on public.request_budgets (window_start);

create or replace function public.consume_request_budget(p_key text, p_limit integer, p_window integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_used integer; v_start timestamptz; v_now timestamptz := clock_timestamp();
begin
  if p_key is null or length(p_key) > 500 or p_limit < 1 or p_window not between 1 and 86400 then
    raise exception 'Invalid request budget.';
  end if;
  -- expired counters only (older than a day); done occasionally, the index makes it cheap
  if random() < 0.01 then
    delete from public.request_budgets where window_start < v_now - interval '1 day';
  end if;
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
