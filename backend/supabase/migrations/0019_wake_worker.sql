-- Start the GitHub Actions worker right away for jobs a user waits on, instead of the next 15-min cron.
-- Inactive until these Vault secrets exist: github_dispatch_token (fine-grained PAT, Actions: write), github_repo ("owner/name"),
-- optional github_ref (default "main"). Local dev doesn't need them: `npm run dev` polls every ~15 s.
create extension if not exists pg_net with schema extensions;

create function public.wake_worker() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  token text;
  repo text;
  ref text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  select decrypted_secret into repo from vault.decrypted_secrets where name = 'github_repo';
  select decrypted_secret into ref from vault.decrypted_secrets where name = 'github_ref';
  if token is not null and repo is not null then
    perform net.http_post(
      url := format('https://api.github.com/repos/%s/actions/workflows/run-tests.yml/dispatches', repo),
      body := jsonb_build_object('ref', coalesce(ref, 'main')),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || token,
        'Accept', 'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent', 'flowguardian'
      )
    );
  end if;
  return null;
exception when others then
  -- Never block adding a site because the wake-up call failed; the cron still picks the job up
  raise warning 'wake_worker: %', sqlerrm;
  return null;
end;
$$;

revoke execute on function public.wake_worker() from public, anon, authenticated;

create trigger wake_on_scan after insert or update of scan_status on public.sites
  for each row when (new.scan_status = 'pending') execute function public.wake_worker();

create trigger wake_on_ai_request after insert on public.ai_requests
  for each row execute function public.wake_worker();
