-- Basic scan report (phase 1): one row per crawled page, replaced on every scan.
create table public.page_checks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  url text not null,
  http_status int,
  load_ms int,
  js_errors jsonb not null default '[]'::jsonb,
  broken_links jsonb not null default '[]'::jsonb,
  broken_images jsonb not null default '[]'::jsonb,
  error text,
  checked_at timestamptz not null default now()
);

create index page_checks_site_idx on public.page_checks (site_id);

alter table public.page_checks enable row level security;

create policy page_checks_select on public.page_checks for select to authenticated
  using (public.owns_site(site_id));

revoke insert, update, delete on public.page_checks from anon, authenticated;
