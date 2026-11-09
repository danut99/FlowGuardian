-- FlowGuardian: schema inițială (profiles → sites → tests → test_steps → runs → incidents)

-- App data for each Supabase Auth user (auth.users holds email/password)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  plan text not null default 'free' check (plan in ('free', 'basic', 'pro')),
  notify_email boolean not null default true,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Users can't change their own plan
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, notify_email) on public.profiles to authenticated;

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  url text not null check (url ~* '^https?://'),
  name text,
  verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('page_load', 'click', 'form')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'paused')),
  enabled boolean not null default true,
  frequency_minutes int not null default 1440 check (frequency_minutes >= 15),
  created_at timestamptz not null default now()
);

create table public.test_steps (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  position int not null,
  action text not null check (action in ('goto', 'click', 'fill', 'expect_visible', 'expect_text', 'expect_url')),
  -- fallback locators, tried in order: [{"type":"role","role":"button","name":"Adaugă în coș"}, {"type":"css","value":"#add-cart"}]
  locators jsonb not null default '[]'::jsonb,
  value text,
  unique (test_id, position)
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'error')),
  failure_kind text check (failure_kind in ('selector_changed', 'real_bug', 'timeout', 'blocked')),
  failed_step int,
  error text,
  duration_ms int,
  screenshot_path text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index runs_test_created_idx on public.runs (test_id, created_at desc);
create index runs_queued_idx on public.runs (created_at) where status = 'queued';

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  test_id uuid not null references public.tests(id) on delete cascade,
  severity text not null check (severity in ('maintenance', 'critical')),
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  message text not null,
  proposed_locators jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Ownership helpers (security definer so policies don't recurse through RLS)
create function public.owns_site(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sites where id = sid and owner_id = auth.uid());
$$;

create function public.owns_test(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tests t join public.sites s on s.id = t.site_id
    where t.id = tid and s.owner_id = auth.uid()
  );
$$;

alter table public.sites enable row level security;
alter table public.tests enable row level security;
alter table public.test_steps enable row level security;
alter table public.runs enable row level security;
alter table public.incidents enable row level security;

create policy sites_owner on public.sites for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy tests_owner on public.tests for all to authenticated
  using (public.owns_site(site_id)) with check (public.owns_site(site_id));

create policy steps_owner on public.test_steps for all to authenticated
  using (public.owns_test(test_id)) with check (public.owns_test(test_id));

create policy runs_select on public.runs for select to authenticated
  using (public.owns_test(test_id));
create policy runs_insert on public.runs for insert to authenticated
  with check (public.owns_test(test_id));

create policy incidents_select on public.incidents for select to authenticated
  using (public.owns_test(test_id));
create policy incidents_update on public.incidents for update to authenticated
  using (public.owns_test(test_id)) with check (public.owns_test(test_id));

-- Column-level limits: users can't self-verify sites or forge run results
revoke insert, update on public.sites from anon, authenticated;
grant insert (url, name) on public.sites to authenticated;
grant update (url, name) on public.sites to authenticated;

revoke insert, update on public.runs from anon, authenticated;
grant insert (test_id) on public.runs to authenticated;

revoke update on public.incidents from anon, authenticated;
grant update (status, resolved_at) on public.incidents to authenticated;

-- Worker API (service_role only)
create function public.enqueue_due_runs() returns int
language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.runs (test_id)
    select t.id from public.tests t
    join public.sites s on s.id = t.site_id
    where t.enabled and t.status = 'approved' and s.verified_at is not null
      and not exists (
        select 1 from public.runs r
        where r.test_id = t.id
          and (r.status in ('queued', 'running')
               or r.created_at > now() - make_interval(mins => t.frequency_minutes))
      )
    returning 1
  )
  select count(*)::int from ins;
$$;

create function public.claim_next_run() returns setof public.runs
language sql security definer set search_path = '' as $$
  update public.runs set status = 'running', started_at = now()
  where id = (
    select id from public.runs
    where status = 'queued'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.enqueue_due_runs() from public, anon, authenticated;
revoke execute on function public.claim_next_run() from public, anon, authenticated;
grant execute on function public.enqueue_due_runs() to service_role;
grant execute on function public.claim_next_run() to service_role;
