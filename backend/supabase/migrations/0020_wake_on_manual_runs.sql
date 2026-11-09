-- Also wake the GitHub worker for the other buttons a user waits on: "Rulează" on tests, page deep analysis, test suggestions.
-- Runs inserted by the worker itself (scheduled, service_role) must not wake it, or every run would trigger the next one.
create trigger wake_on_manual_run after insert on public.runs
  for each statement when (auth.role() = 'authenticated') execute function public.wake_worker();

create trigger wake_on_page_deep after update of deep_status on public.page_checks
  for each row when (new.deep_status = 'pending' and old.deep_status is distinct from 'pending') execute function public.wake_worker();

create trigger wake_on_suggest after update of suggest_status on public.sites
  for each row when (new.suggest_status = 'pending' and old.suggest_status is distinct from 'pending') execute function public.wake_worker();
