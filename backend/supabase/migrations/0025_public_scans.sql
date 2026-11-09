-- Free check from the landing page, no account needed.
-- Only the home page is checked (~10 s). Visitors get a teaser (score, counts, a few issue titles);
-- the full results never leave the database until they sign up and add the site.
create table public.public_scans (
  id uuid primary key default gen_random_uuid(),
  -- Unguessable handle given to the visitor; the row id is never exposed
  token uuid not null unique default gen_random_uuid(),
  url text not null,
  ip_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  teaser jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index public_scans_pending on public.public_scans (created_at) where status = 'pending';
create index public_scans_ip on public.public_scans (ip_hash, created_at);
create index public_scans_url on public.public_scans (url, created_at);

-- No policies: anon/authenticated can't read or write the table, only call the functions below
alter table public.public_scans enable row level security;

create function public.request_public_scan(site_url text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u text := lower(trim(site_url));
  host text;
  ip text := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', 'unknown'), ',', 1);
  ip_h text := md5('fg-public:' || trim(ip));
  t uuid;
begin
  if u !~ '^https?://' then u := 'https://' || u; end if;
  host := substring(u from '^https?://([^/:?#]+)');
  if length(u) > 300 or host is null or host !~ '\.[a-z]{2,}$' or host ~ '^[0-9.]+$'
     or host ~ '(^|\.)(localhost|local|internal|lan|home|corp)$' then
    raise exception 'That doesn''t look like a public website address.';
  end if;
  u := regexp_replace(u, '^(https?://[^/?#]+).*$', '\1') || '/';

  -- Same site checked in the last 30 minutes: share that result instead of scanning again
  select s.token into t from public.public_scans s
  where s.url = u and s.status <> 'error' and s.created_at > now() - interval '30 minutes'
  order by s.created_at desc limit 1;
  if t is not null then return t; end if;

  if (select count(*) from public.public_scans where ip_hash = ip_h and created_at > now() - interval '10 minutes') >= 3
     or (select count(*) from public.public_scans where ip_hash = ip_h and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve run a few free checks already. Create a free account to keep going, or try again later.';
  end if;
  if (select count(*) from public.public_scans where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Lots of people are checking their sites right now. Please try again in a few minutes.';
  end if;

  insert into public.public_scans (url, ip_hash) values (u, ip_h) returning token into t;
  return t;
end;
$$;

create function public.get_public_scan(scan_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('url', url, 'status', status, 'teaser', teaser, 'error', error)
  from public.public_scans where token = scan_token;
$$;

-- Worker only
create function public.claim_next_public_scan() returns setof public.public_scans
language sql security definer set search_path = '' as $$
  update public.public_scans set status = 'running'
  where id = (
    select id from public.public_scans where status = 'pending'
    order by created_at limit 1 for update skip locked
  )
  returning *;
$$;

revoke execute on function public.request_public_scan(text) from public;
grant execute on function public.request_public_scan(text) to anon, authenticated;
revoke execute on function public.get_public_scan(uuid) from public;
grant execute on function public.get_public_scan(uuid) to anon, authenticated;
revoke execute on function public.claim_next_public_scan() from public, anon, authenticated;
grant execute on function public.claim_next_public_scan() to service_role;
