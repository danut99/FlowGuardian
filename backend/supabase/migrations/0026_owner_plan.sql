-- 'owner' plan: no practical limits, for the people running FlowGuardian.
-- Assign it by hand (not in this public repo):  update public.profiles set plan = 'owner' where email = '...';
insert into public.plans (id, label, max_sites, max_ai_tests, api_guardian)
values ('owner', 'Owner', 1000000, 1000000, true)
on conflict (id) do nothing;

-- Plans live in public.plans now; the old fixed list would reject 'owner'
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles drop constraint if exists profiles_plan_fkey;
alter table public.profiles add constraint profiles_plan_fkey foreign key (plan) references public.plans (id);

-- Same as 0024, but the daily AI request cap doesn't apply to owners
create or replace function public.ask_ai(sid uuid, purl text, msg text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  p public.plans := public.plan_of(auth.uid());
begin
  if not exists (select 1 from public.sites where id = sid and owner_id = auth.uid()) then
    raise exception 'Site not found.';
  end if;
  if public.ai_tests_used(auth.uid()) >= p.max_ai_tests then
    raise exception 'Your % plan includes % test% written with AI, and it''s already used.',
      p.label, p.max_ai_tests, case when p.max_ai_tests = 1 then '' else 's' end;
  end if;
  if p.id <> 'owner' and (select count(*) from public.ai_requests r join public.sites s on s.id = r.site_id
      where s.owner_id = auth.uid() and r.created_at > now() - interval '1 day') >= 50 then
    raise exception 'You''ve reached the limit of 50 AI requests per day.';
  end if;
  insert into public.ai_requests (site_id, page_url, prompt) values (sid, purl, msg) returning id into v_id;
  return v_id;
end;
$$;
