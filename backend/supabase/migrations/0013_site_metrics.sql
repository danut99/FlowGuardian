-- History: home-page measurements over time (daily sample, every scan, every deploy) for trend charts.
create table public.site_metrics (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  measured_at timestamptz not null default now(),
  source text not null check (source in ('scan', 'deploy', 'daily')),
  score int,
  load_ms int,
  ttfb int,
  lcp int,
  cls real,
  bytes int,
  requests int,
  js_errors int
);

create index site_metrics_site_time_idx on public.site_metrics (site_id, measured_at desc);

alter table public.site_metrics enable row level security;

create policy site_metrics_select on public.site_metrics for select to authenticated
  using (public.owns_site(site_id));

revoke insert, update, delete on public.site_metrics from anon, authenticated;
