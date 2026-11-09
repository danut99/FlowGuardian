-- Private bucket; worker uploads with service_role as {test_id}/{run_id}.png
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false);

create policy screenshots_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and public.owns_test(((storage.foldername(name))[1])::uuid));
