-- Deploy detection: the worker fingerprints the home page's own JS/CSS assets every run.
-- When it changes, it records a deploy, re-measures the page, compares with the previous version and re-runs the site's tests.
alter table public.sites
  add column deploy_fingerprint text,
  add column deploy_checked_at timestamptz,
  -- 'unstable' = asset URLs change on every request (cache busters), so detection is off for this site
  add column deploy_tracking text not null default 'on' check (deploy_tracking in ('on', 'unstable')),
  -- Home page measurements of the current production version
  add column baseline jsonb;

create table public.deploys (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  detected_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  -- {"added": [...], "removed": [...], "generator": {"before": "...", "after": "..."}}
  changes jsonb not null default '{}'::jsonb,
  before jsonb,
  after jsonb,
  -- [{"severity":"high|medium|low|info","improved":bool,"message":"..."}]
  findings jsonb not null default '[]'::jsonb,
  error text
);

create index deploys_site_detected_idx on public.deploys (site_id, detected_at desc);

alter table public.deploys enable row level security;

create policy deploys_select on public.deploys for select to authenticated
  using (public.owns_site(site_id));

revoke insert, update, delete on public.deploys from anon, authenticated;

alter publication supabase_realtime add table public.deploys;
