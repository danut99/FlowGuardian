-- API Guardian: periodic HTTP checks on API endpoints with status, speed and JSON rules.
create table public.api_monitors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  url text not null check (url ~* '^https?://'),
  method text not null default 'GET' check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD')),
  -- [{"name":"Authorization","value":"Bearer ..."}]; visible only to the owner (RLS)
  headers jsonb not null default '[]'::jsonb,
  body text check (length(body) <= 20000),
  expected_status int not null default 200 check (expected_status between 100 and 599),
  max_ms int not null default 2000 check (max_ms between 100 and 60000),
  -- [{"path":"products.length","op":">","value":"0"}]
  rules jsonb not null default '[]'::jsonb,
  frequency_minutes int not null default 15 check (frequency_minutes >= 15),
  enabled boolean not null default true,
  run_requested boolean not null default false,
  last_status text check (last_status in ('passed', 'failed', 'error')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.api_checks (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.api_monitors(id) on delete cascade,
  status text not null check (status in ('passed', 'failed', 'error')),
  http_status int,
  duration_ms int,
  error text,
  -- [{"rule":{...},"actual":"..."}]
  failures jsonb not null default '[]'::jsonb,
  response_sample text,
  created_at timestamptz not null default now()
);

create index api_checks_monitor_created_idx on public.api_checks (monitor_id, created_at desc);

create function public.owns_api_monitor(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.api_monitors where id = mid and owner_id = auth.uid());
$$;

alter table public.api_monitors enable row level security;
alter table public.api_checks enable row level security;

create policy api_monitors_owner on public.api_monitors for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy api_checks_select on public.api_checks for select to authenticated
  using (public.owns_api_monitor(monitor_id));

-- Results are written by the worker only
revoke insert, update on public.api_monitors from anon, authenticated;
grant insert (name, url, method, headers, body, expected_status, max_ms, rules, frequency_minutes, enabled)
  on public.api_monitors to authenticated;
grant update (name, url, method, headers, body, expected_status, max_ms, rules, frequency_minutes, enabled, run_requested)
  on public.api_monitors to authenticated;
revoke insert, update, delete on public.api_checks from anon, authenticated;

-- Worker: claim a batch of due monitors (or ones the user asked to run now)
create function public.claim_due_api_monitors(batch int default 50) returns setof public.api_monitors
language sql security definer set search_path = '' as $$
  update public.api_monitors set last_checked_at = now(), run_requested = false
  where id in (
    select id from public.api_monitors
    where enabled and (
      run_requested
      or last_checked_at is null
      -- Slack of 2 min so a 15-min monitor isn't skipped when the 15-min cron fires slightly early
      or last_checked_at + make_interval(mins => frequency_minutes - 2) <= now()
    )
    order by last_checked_at nulls first
    limit batch
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.claim_due_api_monitors(int) from public, anon, authenticated;
grant execute on function public.claim_due_api_monitors(int) to service_role;

alter publication supabase_realtime add table public.api_monitors;
alter publication supabase_realtime add table public.api_checks;
