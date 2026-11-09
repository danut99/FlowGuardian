-- The always-on server and the GitHub backup can both schedule due runs at the same moment: serialize them so a test isn't queued twice.
create or replace function public.enqueue_due_runs() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('enqueue_due_runs'));
  with ins as (
    insert into public.runs (test_id)
    select t.id from public.tests t
    join public.sites s on s.id = t.site_id
    where t.enabled and t.status = 'approved' and s.verified_at is not null
      and not exists (
        select 1 from public.runs r
        where r.test_id = t.id
          and (r.status in ('queued', 'running')
               or r.created_at > now() - make_interval(mins => t.frequency_minutes))
      )
    returning 1
  )
  select count(*)::int into n from ins;
  return n;
end;
$$;

revoke execute on function public.enqueue_due_runs() from public, anon, authenticated;
grant execute on function public.enqueue_due_runs() to service_role;
