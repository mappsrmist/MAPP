-- NOT APPLIED. Review, then run yourself in the Supabase SQL editor (schema change, no row data touched).
-- Why: consume_request_budget() runs on EVERY student RPC and EVERY login. It does
--   delete from request_budgets where window_start < now() - 1 day
-- with no index on window_start (full scan + write on every call), and all logins from campus NAT
-- update the single hot row 'login:ip:<ip>' (row-lock serialisation during a login burst).
create index concurrently if not exists request_budgets_window_idx on public.request_budgets (window_start);
