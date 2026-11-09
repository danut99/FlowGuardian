-- Plans and limits, enforced in the database (the UI only mirrors them).
-- Everyone starts on 'free' (trial): 1 website, 1 test written with AI, no API Guardian.
create table public.plans (
  id text primary key,
  label text not null,
  max_sites int not null,
  max_ai_tests int not null,
  api_guardian boolean not null
);

insert into public.plans (id, label, max_sites, max_ai_tests, api_guardian) values
  ('free', 'Free trial', 1, 1, false),
  ('basic', 'Basic', 5, 20, true),
  ('pro', 'Pro', 50, 200, true);

alter table public.plans enable row level security;
create policy plans_read on public.plans for select to anon, authenticated using (true);
revoke insert, update, delete on public.plans from anon, authenticated;

alter table public.tests add column created_with_ai boolean not null default false;

create function public.plan_of(uid uuid) returns public.plans
language sql stable security definer set search_path = '' as $$
  select p.* from public.plans p join public.profiles pr on pr.plan = p.id where pr.id = uid;
$$;

create function public.ai_tests_used(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.tests t join public.sites s on s.id = t.site_id
  where s.owner_id = uid and t.created_with_ai;
$$;

-- What the UI shows: plan + usage
create function public.my_plan() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'label', p.label,
    'max_sites', p.max_sites, 'sites', (select count(*) from public.sites where owner_id = auth.uid()),
    'max_ai_tests', p.max_ai_tests, 'ai_tests', public.ai_tests_used(auth.uid()),
    'api_guardian', p.api_guardian
  )
  from public.plan_of(auth.uid()) p;
$$;

revoke execute on function public.plan_of(uuid) from public, anon, authenticated;
revoke execute on function public.ai_tests_used(uuid) from public, anon, authenticated;
revoke execute on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- Sites: per-plan cap (service_role/worker inserts have no auth.uid() and aren't limited)
create function public.enforce_site_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.plans := public.plan_of(new.owner_id);
begin
  if auth.uid() is not null and p.id is not null
     and (select count(*) from public.sites where owner_id = new.owner_id) >= p.max_sites then
    raise exception 'Your % plan includes % website%. Delete the existing one to add another.',
      p.label, p.max_sites, case when p.max_sites = 1 then '' else 's' end;
  end if;
  return new;
end;
$$;

create trigger sites_plan_limit before insert on public.sites
  for each row execute function public.enforce_site_limit();

-- API Guardian: only on plans that include it
create function public.enforce_api_guardian() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not coalesce((public.plan_of(new.owner_id)).api_guardian, false) then
    raise exception 'API Guardian is not included in your plan.';
  end if;
  return new;
end;
$$;

create trigger api_monitors_plan before insert on public.api_monitors
  for each row execute function public.enforce_api_guardian();

-- AI: no new AI drafts once the AI-test allowance is used up
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
  if (select count(*) from public.ai_requests r join public.sites s on s.id = r.site_id
      where s.owner_id = auth.uid() and r.created_at > now() - interval '1 day') >= 50 then
    raise exception 'You''ve reached the limit of 50 AI requests per day.';
  end if;
  insert into public.ai_requests (site_id, page_url, prompt) values (sid, purl, msg) returning id into v_id;
  return v_id;
end;
$$;

-- save_test gains `ai`: AI-built tests count against the plan
drop function public.save_test(uuid, uuid, text, text, int, text, jsonb);

create function public.save_test(
  sid uuid, tid uuid, tname text, tkind text, freq int, purl text, steps jsonb, ai boolean default false
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := tid;
  p public.plans;
begin
  if jsonb_array_length(steps) = 0 or jsonb_array_length(steps) > 30 then
    raise exception 'A test has between 1 and 30 steps.';
  end if;

  if v_id is null then
    if ai then
      p := public.plan_of(auth.uid());
      if public.ai_tests_used(auth.uid()) >= p.max_ai_tests then
        raise exception 'Your % plan includes % test% written with AI, and it''s already used.',
          p.label, p.max_ai_tests, case when p.max_ai_tests = 1 then '' else 's' end;
      end if;
      perform set_config('fg.saving_ai', 'on', true);
    end if;
    insert into public.tests (site_id, name, kind, status, frequency_minutes, page_url, created_with_ai)
    values (sid, tname, tkind, 'approved', freq, purl, ai)
    returning id into v_id;
  else
    update public.tests set name = tname, kind = tkind, frequency_minutes = freq, page_url = purl
    where id = v_id and site_id = sid and essential_key is null;
    if not found then
      raise exception 'The test doesn''t exist or can''t be edited.';
    end if;
  end if;

  delete from public.test_steps where test_steps.test_id = v_id;
  insert into public.test_steps (test_id, position, action, locators, value, note)
  select v_id, s.ord::int, s.step ->> 'action', coalesce(s.step -> 'locators', '[]'::jsonb), s.step ->> 'value',
         left(nullif(s.step ->> 'note', ''), 160)
  from jsonb_array_elements(steps) with ordinality as s(step, ord);

  return v_id;
end;
$$;

revoke execute on function public.save_test(uuid, uuid, text, text, int, text, jsonb, boolean) from public, anon;
grant execute on function public.save_test(uuid, uuid, text, text, int, text, jsonb, boolean) to authenticated;

-- Users can't flip the AI flag themselves (direct inserts/updates keep it honest)
create function public.keep_ai_flag() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and current_setting('fg.saving_ai', true) is distinct from 'on' then
    new.created_with_ai := case when tg_op = 'UPDATE' then old.created_with_ai else false end;
  end if;
  return new;
end;
$$;

create trigger tests_keep_ai_flag before insert or update on public.tests
  for each row execute function public.keep_ai_flag();
