-- Test suggestions per page + richer test types (search, interaction, content).
alter table public.sites add column suggest_url text;
alter table public.tests add column page_url text;

alter table public.tests drop constraint tests_kind_check;
alter table public.tests add constraint tests_kind_check
  check (kind in ('page_load', 'click', 'form', 'health', 'search', 'interaction', 'content'));

alter table public.test_steps drop constraint test_steps_action_check;
alter table public.test_steps add constraint test_steps_action_check
  check (action in ('goto', 'dismiss', 'click', 'fill', 'press', 'expect_visible', 'expect_text', 'expect_url', 'check'));

drop function public.request_suggestions(uuid);

-- page_url must be on the site's own host (checked in the worker too)
create function public.request_suggestions(sid uuid, page_url text default null) returns void
language sql security definer set search_path = '' as $$
  update public.sites set suggest_status = 'pending', suggest_url = page_url
  where id = sid and owner_id = auth.uid() and suggest_status in ('idle', 'done', 'error');
$$;

revoke execute on function public.request_suggestions(uuid, text) from public, anon;
grant execute on function public.request_suggestions(uuid, text) to authenticated;
