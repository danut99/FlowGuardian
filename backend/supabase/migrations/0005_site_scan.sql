-- Auto-discovery: adding a site queues a scan; the worker proposes tests from the page.
alter table public.sites
  add column scan_status text not null default 'pending' check (scan_status in ('pending', 'scanning', 'done', 'error')),
  add column scan_error text,
  add column scanned_at timestamptz;

create function public.claim_next_scan() returns setof public.sites
language sql security definer set search_path = '' as $$
  update public.sites set scan_status = 'scanning', scan_error = null
  where id = (
    select id from public.sites
    where scan_status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.claim_next_scan() from public, anon, authenticated;
grant execute on function public.claim_next_scan() to service_role;

create function public.request_scan(sid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.sites set scan_status = 'pending'
  where id = sid and owner_id = auth.uid() and scan_status in ('done', 'error');
$$;

revoke execute on function public.request_scan(uuid) from public, anon;
grant execute on function public.request_scan(uuid) to authenticated;

alter publication supabase_realtime add table public.sites;

-- dismiss = click only if visible (cookie banners that may not reappear)
alter table public.test_steps drop constraint test_steps_action_check;
alter table public.test_steps add constraint test_steps_action_check
  check (action in ('goto', 'dismiss', 'click', 'fill', 'expect_visible', 'expect_text', 'expect_url'));
