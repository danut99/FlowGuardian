-- Developer mode: technical context captured when a run fails (console, JS errors with stack, failed requests).
alter table public.runs add column debug jsonb;
