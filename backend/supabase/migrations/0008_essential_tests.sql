-- Essential health tests created automatically for every site (one per essential_key).
alter table public.tests drop constraint tests_kind_check;
alter table public.tests add constraint tests_kind_check check (kind in ('page_load', 'click', 'form', 'health'));
alter table public.tests add column essential_key text;

update public.tests set essential_key = 'availability'
where kind = 'page_load' and status = 'approved' and name = 'Site-ul e disponibil';

create unique index tests_site_essential_idx on public.tests (site_id, essential_key) where essential_key is not null;

-- check = built-in health check, step.value names it (e.g. 'speed:5000', 'ssl:14')
alter table public.test_steps drop constraint test_steps_action_check;
alter table public.test_steps add constraint test_steps_action_check
  check (action in ('goto', 'dismiss', 'click', 'fill', 'expect_visible', 'expect_text', 'expect_url', 'check'));
