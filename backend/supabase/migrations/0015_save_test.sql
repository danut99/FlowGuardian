-- Test editor: create or update a test and replace all its steps atomically.
-- security invoker: RLS still decides which sites/tests the caller may touch.
create function public.save_test(
  sid uuid, tid uuid, tname text, tkind text, freq int, purl text, steps jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := tid;
begin
  if jsonb_array_length(steps) = 0 or jsonb_array_length(steps) > 30 then
    raise exception 'Un test are între 1 și 30 de pași.';
  end if;

  if v_id is null then
    insert into public.tests (site_id, name, kind, status, frequency_minutes, page_url)
    values (sid, tname, tkind, 'approved', freq, purl)
    returning id into v_id;
  else
    update public.tests set name = tname, kind = tkind, frequency_minutes = freq, page_url = purl
    where id = v_id and site_id = sid and essential_key is null;
    if not found then
      raise exception 'Testul nu există sau nu poate fi editat.';
    end if;
  end if;

  delete from public.test_steps where test_steps.test_id = v_id;
  insert into public.test_steps (test_id, position, action, locators, value)
  select v_id, s.ord::int, s.step ->> 'action', coalesce(s.step -> 'locators', '[]'::jsonb), s.step ->> 'value'
  from jsonb_array_elements(steps) with ordinality as s(step, ord);

  return v_id;
end;
$$;

revoke execute on function public.save_test(uuid, uuid, text, text, int, text, jsonb) from public, anon;
grant execute on function public.save_test(uuid, uuid, text, text, int, text, jsonb) to authenticated;
