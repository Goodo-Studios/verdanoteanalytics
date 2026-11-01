-- Dashboard data foundation 4/6: storage buckets
--
-- The 12 private buckets the dashboard keeps creator, actor and location media
-- in, with the same size limits and file types. Staff can read all of them and
-- write the ones staff upload to. Clients and anon have no access. The two
-- application upload buckets per kind are filled by the public forms on the old
-- dashboard, so staff only read them here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('actor-application-headshots', 'actor-application-headshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('actor-application-videos', 'actor-application-videos', false, 262144000, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('actor-headshots', 'actor-headshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('actor-photos', 'actor-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('actor-videos', 'actor-videos', false, 262144000, array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-application-headshots', 'creator-application-headshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-application-videos', 'creator-application-videos', false, 262144000, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-family-pet-photos', 'creator-family-pet-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-filming-locations', 'creator-filming-locations', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-headshots', 'creator-headshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-videos', 'creator-videos', false, 104857600, array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('location-photos', 'location-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Dashboard staff read actor-application-headshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'actor-application-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read actor-application-videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'actor-application-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read actor-headshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'actor-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read actor-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'actor-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read actor-videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'actor-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read creator-application-headshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-application-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read creator-application-videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-application-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read creator-family-pet-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-family-pet-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read creator-filming-locations" on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-filming-locations' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read creator-headshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read creator-videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff read location-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'location-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write actor-headshots" on storage.objects
  for all to authenticated
  using (bucket_id = 'actor-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'actor-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write actor-photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'actor-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'actor-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write actor-videos" on storage.objects
  for all to authenticated
  using (bucket_id = 'actor-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'actor-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write creator-family-pet-photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'creator-family-pet-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'creator-family-pet-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write creator-filming-locations" on storage.objects
  for all to authenticated
  using (bucket_id = 'creator-filming-locations' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'creator-filming-locations' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write creator-headshots" on storage.objects
  for all to authenticated
  using (bucket_id = 'creator-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'creator-headshots' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write creator-videos" on storage.objects
  for all to authenticated
  using (bucket_id = 'creator-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'creator-videos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write location-photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'location-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'location-photos' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

