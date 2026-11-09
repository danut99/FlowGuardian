-- Per-page analysis: automatic for every crawled page after the scan (stage 2), deep analysis on demand (stage 3).
alter table public.sites
  add column pages_status text not null default 'idle' check (pages_status in ('idle', 'pending', 'running', 'done', 'error'));

alter table public.page_checks
  add column status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  add column analysis_error text,
  add column score int,
  add column metrics jsonb,
  add column checks jsonb not null default '[]'::jsonb,
  add column deep_status text not null default 'idle' check (deep_status in ('idle', 'pending', 'running', 'done', 'error')),
  add column deep jsonb,
  add column deep_error text;

-- Pages crawled before this migration get analyzed on the next worker run
update public.sites s set pages_status = 'pending'
where exists (select 1 from public.page_checks p where p.site_id = s.id);

create function public.claim_next_pages() returns setof public.sites
language sql security definer set search_path = '' as $$
  update public.sites set pages_status = 'running'
  where id = (
    select id from public.sites
    where pages_status = 'pending'
    order by scanned_at nulls last
    limit 1
    for update skip locked
  )
  returning *;
$$;

create function public.claim_next_deep() returns setof public.page_checks
language sql security definer set search_path = '' as $$
  update public.page_checks set deep_status = 'running', deep_error = null
  where id = (
    select id from public.page_checks
    where deep_status = 'pending'
    order by checked_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.claim_next_pages() from public, anon, authenticated;
revoke execute on function public.claim_next_deep() from public, anon, authenticated;
grant execute on function public.claim_next_pages() to service_role;
grant execute on function public.claim_next_deep() to service_role;

create function public.request_page_deep(pid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.page_checks set deep_status = 'pending'
  where id = pid and public.owns_site(site_id) and deep_status in ('idle', 'done', 'error');
$$;

revoke execute on function public.request_page_deep(uuid) from public, anon;
grant execute on function public.request_page_deep(uuid) to authenticated;

alter publication supabase_realtime add table public.page_checks;

-- Deep-analysis screenshots, stored as {site_id}/{page_check_id}/{name}.png
insert into storage.buckets (id, name, public) values ('page-shots', 'page-shots', false);

create policy page_shots_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'page-shots' and public.owns_site(((storage.foldername(name))[1])::uuid));
