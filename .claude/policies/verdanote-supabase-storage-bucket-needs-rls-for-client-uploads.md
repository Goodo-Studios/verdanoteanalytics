---
id: verdanote-supabase-storage-bucket-needs-rls-for-client-uploads
title: Manually created Supabase storage buckets need explicit RLS policies on `storage.objects` for client-side uploads
scope: repo
trigger: when creating a Supabase storage bucket that will be uploaded to from the browser (user JWT) rather than only from edge functions
enforcement: hard
public: false
version: 1
created: 2026-05-28
updated: 2026-05-28
source: session-learning
applies_to: [supabase]
tags: [vendor:supabase, storage, rls, client-uploads]
---

## Rule

When you create a Supabase storage bucket via the dashboard or `POST /storage/v1/bucket`, the bucket has **zero RLS policies on `storage.objects`** by default. Any code path that uploads with a user JWT (the browser client, a worker using the anon key) will silently fail with a permission error until you add an explicit `INSERT` policy.

Edge functions using the `service_role` key bypass RLS entirely — so the missing policy is invisible if you only test server-side. The failure appears only when the *client* tries to upload.

For every bucket used by client-side code, write an explicit migration (don't rely on dashboard clicks — they don't survive project recreation) covering at least `INSERT`, `SELECT`, and `DELETE` for the bucket. Pattern:

```sql
create policy "users can upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = '{bucket_name}'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "users can read their own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = '{bucket_name}'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "users can delete their own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = '{bucket_name}'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
```

Verify policies exist:

```sql
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and qual like '%{bucket_name}%' or with_check like '%{bucket_name}%';
```

If the bucket is meant to be fully public (anonymous read), set `public: true` on the bucket itself — that bypasses RLS for `SELECT` only, not for writes.

## Rationale

Storage buckets and RLS policies are two separate concerns in Supabase: creating a bucket adds a row to `storage.buckets`, but does not write any rows to `pg_policies`. RLS on `storage.objects` is enabled by default (RLS-on, no policies = deny-all for non-bypassing roles).

The reason the bug is so hard to spot:

- **Service-role bypasses RLS.** Any edge function or server script using `SUPABASE_SERVICE_ROLE_KEY` will upload successfully, so server-side smoke tests don't catch the missing policy.
- **Client-side error surfaces as a generic 403/400** with messages like `new row violates row-level security policy` or `Unauthorized` — depending on the SDK version, this can look like an auth bug rather than a policy bug.
- **Dashboard-created policies aren't version-controlled.** A teammate or environment recreation can silently lose them.

Encountered 2026-05-28 while wiring up client-side video uploads in Verdanote. The bucket existed and the user was authenticated, but uploads returned 403. Root cause was zero RLS policies on `storage.objects` for that bucket. Related learning (HQ-wide): RLS asymmetry between SELECT and UPDATE/DELETE in `core/policies/...` and the Creative Vault session-learning about checking `workspaces.owner_id` AND `workspace_members`.
