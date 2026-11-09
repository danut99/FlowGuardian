-- Overview + essential checks run automatically on scan; test suggestions only on demand.
alter table public.sites
  add column overview jsonb,
  add column suggest_status text not null default 'idle' check (suggest_status in ('idle', 'pending', 'running', 'done', 'error')),
  add column suggest_error text;

create function public.claim_next_suggest() returns setof public.sites
language sql security definer set search_path = '' as $$
  update public.sites set suggest_status = 'running', suggest_error = null
  where id = (
    select id from public.sites
    where suggest_status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.claim_next_suggest() from public, anon, authenticated;
grant execute on function public.claim_next_suggest() to service_role;

create function public.request_suggestions(sid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.sites set suggest_status = 'pending'
  where id = sid and owner_id = auth.uid() and suggest_status in ('idle', 'done', 'error');
$$;

revoke execute on function public.request_suggestions(uuid) from public, anon;
grant execute on function public.request_suggestions(uuid) to authenticated;
