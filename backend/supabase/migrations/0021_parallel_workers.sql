-- Parallel workers: every wake-up starts its own GitHub run (the workflow no longer queues them behind each other),
-- named after what triggered it ("Analiză site · exemplu.ro") so the Actions list shows who's doing what.
-- Cap: at most 5 started in the last 3 minutes, so a burst of clicks can't spin up dozens of runners.
-- Safe to re-run.
create table if not exists public.worker_wakes (at timestamptz not null default now());
alter table public.worker_wakes enable row level security;

create or replace function public.dispatch_worker(reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  token text;
  repo text;
  ref text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  select decrypted_secret into repo from vault.decrypted_secrets where name = 'github_repo';
  select decrypted_secret into ref from vault.decrypted_secrets where name = 'github_ref';
  if token is null or repo is null then
    return;
  end if;
  delete from public.worker_wakes where at < now() - interval '1 hour';
  if (select count(*) from public.worker_wakes where at > now() - interval '3 minutes') >= 5 then
    return;
  end if;
  insert into public.worker_wakes default values;
  perform net.http_post(
    url := format('https://api.github.com/repos/%s/actions/workflows/run-tests.yml/dispatches', repo),
    body := jsonb_build_object('ref', coalesce(ref, 'main'), 'inputs', jsonb_build_object('reason', left(reason, 100))),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'flowguardian'
    )
  );
exception when others then
  -- Never block the user's action because the wake-up call failed; the cron still picks the job up
  raise warning 'dispatch_worker: %', sqlerrm;
end;
$$;

create or replace function public.site_host(u text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(u, ''), '^https?://(www\.)?([^/?#]+).*$', '\2');
$$;

-- Row triggers: TG_ARGV[0] is the job label; the site comes from the row's site_id (or the row itself for sites)
create or replace function public.wake_worker() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(new);
  site_url text;
  detail text;
begin
  select url into site_url from public.sites
    where id = (case when tg_table_name = 'sites' then r->>'id' else r->>'site_id' end)::uuid;
  detail := public.site_host(site_url);
  if tg_table_name = 'page_checks' then
    detail := detail || regexp_replace(coalesce(r->>'url', ''), '^https?://[^/]+', '');
  end if;
  perform public.dispatch_worker(tg_argv[0] || ' · ' || detail);
  return null;
exception when others then
  raise warning 'wake_worker: %', sqlerrm;
  return null;
end;
$$;

-- "Rulează toate" inserts many runs in one statement: one worker, named after the site and the count
create or replace function public.wake_worker_runs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n int;
  hosts text;
begin
  select count(*), string_agg(distinct public.site_host(s.url), ', ')
    into n, hosts
    from inserted i join public.tests t on t.id = i.test_id join public.sites s on s.id = t.site_id;
  perform public.dispatch_worker(case when n = 1 then 'Test' else format('Teste (%s)', n) end || ' · ' || coalesce(hosts, ''));
  return null;
exception when others then
  raise warning 'wake_worker_runs: %', sqlerrm;
  return null;
end;
$$;

revoke execute on function public.dispatch_worker(text) from public, anon, authenticated;
revoke execute on function public.wake_worker() from public, anon, authenticated;
revoke execute on function public.wake_worker_runs() from public, anon, authenticated;

drop trigger if exists wake_on_scan on public.sites;
create trigger wake_on_scan after insert or update of scan_status on public.sites
  for each row when (new.scan_status = 'pending') execute function public.wake_worker('Analiză site');

drop trigger if exists wake_on_ai_request on public.ai_requests;
create trigger wake_on_ai_request after insert on public.ai_requests
  for each row execute function public.wake_worker('Asistent AI');

drop trigger if exists wake_on_page_deep on public.page_checks;
create trigger wake_on_page_deep after update of deep_status on public.page_checks
  for each row when (new.deep_status = 'pending' and old.deep_status is distinct from 'pending')
  execute function public.wake_worker('Analiză pagină');

drop trigger if exists wake_on_suggest on public.sites;
create trigger wake_on_suggest after update of suggest_status on public.sites
  for each row when (new.suggest_status = 'pending' and old.suggest_status is distinct from 'pending')
  execute function public.wake_worker('Propuneri teste');

-- Scheduled runs come from the worker itself (service_role) and must not wake it again
drop trigger if exists wake_on_manual_run on public.runs;
create trigger wake_on_manual_run after insert on public.runs
  referencing new table as inserted
  for each statement when (auth.role() = 'authenticated') execute function public.wake_worker_runs();
