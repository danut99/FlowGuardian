-- AI assistant: user describes a test in plain words, the worker builds + dry-runs it.
create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  page_url text,
  prompt text not null check (char_length(prompt) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  reply text,
  draft jsonb,
  verified boolean,
  verify_error text,
  error text,
  created_at timestamptz not null default now()
);

create index ai_requests_site_idx on public.ai_requests (site_id, created_at desc);

alter table public.ai_requests enable row level security;

create policy ai_requests_select on public.ai_requests for select to authenticated
  using (public.owns_site(site_id));

revoke insert, update, delete on public.ai_requests from anon, authenticated;

-- Only way for users to create requests; caps AI usage per user
create function public.ask_ai(sid uuid, purl text, msg text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.sites where id = sid and owner_id = auth.uid()) then
    raise exception 'Site inexistent.';
  end if;
  if (select count(*) from public.ai_requests r join public.sites s on s.id = r.site_id
      where s.owner_id = auth.uid() and r.created_at > now() - interval '1 day') >= 50 then
    raise exception 'Ai atins limita de 50 de cereri AI pe zi.';
  end if;
  insert into public.ai_requests (site_id, page_url, prompt) values (sid, purl, msg) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.ask_ai(uuid, text, text) from public, anon;
grant execute on function public.ask_ai(uuid, text, text) to authenticated;

create function public.claim_next_ai() returns setof public.ai_requests
language sql security definer set search_path = '' as $$
  update public.ai_requests set status = 'running'
  where id = (
    select id from public.ai_requests where status = 'pending'
    order by created_at limit 1 for update skip locked
  )
  returning *;
$$;

revoke execute on function public.claim_next_ai() from public, anon, authenticated;
grant execute on function public.claim_next_ai() to service_role;

alter publication supabase_realtime add table public.ai_requests;
