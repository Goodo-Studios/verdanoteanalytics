-- Dashboard moodboard reference images: private bucket
--
-- The old dashboard keeps a 13th bucket, moodboard-refs, that was created by
-- hand and is not in its migrations. Same limit (8 MB) and file types as the
-- old bucket. Staff can read and write it. Clients and anon have no access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('moodboard-refs', 'moodboard-refs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "Dashboard staff read moodboard-refs" on storage.objects
  for select to authenticated
  using (bucket_id = 'moodboard-refs' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));

create policy "Dashboard staff write moodboard-refs" on storage.objects
  for all to authenticated
  using (bucket_id = 'moodboard-refs' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)))
  with check (bucket_id = 'moodboard-refs' and (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)));
