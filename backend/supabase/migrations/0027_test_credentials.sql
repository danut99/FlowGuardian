-- Test-account credentials are encrypted by Vault, never stored in test_steps.
create extension if not exists supabase_vault with schema vault;
revoke all on schema vault from public, anon, authenticated;
revoke all on vault.secrets, vault.decrypted_secrets from public, anon, authenticated;
create table public.test_credentials (
  test_id uuid primary key references public.tests(id) on delete cascade,
  secret_id uuid not null unique,
  site_url text not null,
  updated_at timestamptz not null default now()
);
alter table public.test_credentials enable row level security;
revoke all on public.test_credentials from public, anon, authenticated;

create function public.test_credentials_status(tid uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_test(tid) then raise exception 'Flow not available.'; end if;
  return exists(select 1 from public.test_credentials c join public.tests t on t.id = c.test_id
    join public.sites s on s.id = t.site_id where c.test_id = tid and c.site_url = s.url);
end;
$$;

-- Passing null/null explicitly removes the saved account.
create function public.set_test_credentials(tid uuid, test_username text, test_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid; v_test public.tests; v_site public.sites;
begin
  select * into v_test from public.tests where id = tid for update;
  if not found or not public.owns_test(tid) or left(v_test.name, 7) <> '[Flow] ' then
    raise exception 'Flow not available.';
  end if;
  select * into v_site from public.sites where id = v_test.site_id;
  if v_site.verified_at is null or v_site.url !~* '^https://' then
    raise exception 'A verified HTTPS site is required for a test account.';
  end if;
  if exists(select 1 from public.runs where test_id = tid and status in ('queued', 'running')) then
    raise exception 'Wait for the queued or running check before changing the test account.';
  end if;
  if (test_username is null) <> (test_password is null) or
     (test_username is not null and (length(btrim(test_username)) = 0 or length(test_password) = 0 or length(test_username) > 500 or length(test_password) > 4096)) then
    raise exception 'Provide both a test username and password, within the supported lengths.';
  end if;
  select secret_id into v_secret from public.test_credentials where test_id = tid;
  if test_username is null then
    delete from public.test_credentials where test_id = tid;
  elsif v_secret is null then
    select vault.create_secret(jsonb_build_object('username', test_username, 'password', test_password)::text,
      'flow-test-account-' || tid::text, 'Dedicated website test account') into v_secret;
    insert into public.test_credentials(test_id, secret_id, site_url) values (tid, v_secret, v_site.url);
  else
    perform vault.update_secret(v_secret, jsonb_build_object('username', test_username, 'password', test_password)::text);
    update public.test_credentials set updated_at = now(), site_url = v_site.url where test_id = tid;
  end if;
  update public.tests set enabled = false, status = 'paused' where id = tid;
  update public.test_steps set note = 'Flow v1|' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
    coalesce(regexp_replace(note, '^Flow v1\|[^|]+\|', ''), '') where test_id = tid and position = 1;
end;
$$;

create function public.delete_test_credential_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;
create trigger delete_test_credential_secret after delete on public.test_credentials
  for each row execute function public.delete_test_credential_secret();

create function public.worker_test_credentials(tid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  select v.decrypted_secret::jsonb into result from public.test_credentials c
    join public.tests t on t.id = c.test_id join public.sites s on s.id = t.site_id
    join vault.decrypted_secrets v on v.id = c.secret_id
    where c.test_id = tid and left(t.name, 7) = '[Flow] ' and c.site_url = s.url and s.verified_at is not null and s.url ~* '^https://';
  return result;
end;
$$;
revoke all on function public.test_credentials_status(uuid) from public, anon;
revoke all on function public.set_test_credentials(uuid,text,text) from public, anon;
revoke all on function public.worker_test_credentials(uuid) from public, anon, authenticated;
revoke all on function public.delete_test_credential_secret() from public, anon, authenticated;
grant execute on function public.test_credentials_status(uuid) to authenticated;
grant execute on function public.set_test_credentials(uuid,text,text) to authenticated;
grant execute on function public.worker_test_credentials(uuid) to service_role;
