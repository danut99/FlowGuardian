-- Queue audits through a narrow owner-only API; keep scan fields worker-managed.
create function public.request_website_audit(sid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_site public.sites;
begin
  select * into v_site from public.sites
    where id = sid and owner_id = auth.uid() for update;
  if not found then
    raise exception 'Site not available.';
  end if;
  if v_site.scan_status in ('pending', 'scanning') then
    raise exception 'Wait for the current scan to finish before requesting an audit.';
  end if;
  update public.sites
    set overview = coalesce(overview, '{}'::jsonb) || '{"audit_requested": true}'::jsonb,
        scan_status = 'pending', scan_error = null
    where id = sid;
end;
$$;

revoke all on function public.request_website_audit(uuid) from public, anon;
grant execute on function public.request_website_audit(uuid) to authenticated;
