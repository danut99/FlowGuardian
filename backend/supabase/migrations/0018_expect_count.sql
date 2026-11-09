-- expect_count: check how many repeated items (cards, plans, products) a section shows.
alter table public.test_steps drop constraint test_steps_action_check;
alter table public.test_steps add constraint test_steps_action_check
  check (action in ('goto', 'dismiss', 'click', 'fill', 'press', 'expect_visible', 'expect_text', 'expect_url', 'expect_count', 'check'));
