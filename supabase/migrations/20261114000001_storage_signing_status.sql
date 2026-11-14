-- Phase 6b: Integration health shows whether the two storage signing secrets are set.
--
-- Approving an application that has files and deleting a location that has photos move
-- files through storage_admin_request (migration 20261101000002), which reads two vault
-- secrets: storage_signing_project_url and storage_signing_service_role_key. When either is
-- missing those two actions fail. This function lets the integration-health function say,
-- for each name, whether the secret is present. It returns names and true or false only,
-- never a value, and only the service role can call it (the integration-health function
-- calls it after its own staff check).
--
-- No table is added and no policy changes. Staff upload and delete media with their own
-- login under the staff write policies on the media buckets (migration 20261101000004) and
-- the staff row rules on the media tables (migration 20261101000003).

create or replace function public.storage_signing_secrets_present()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url boolean;
  v_key boolean;
begin
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'storage_signing_project_url' and coalesce(decrypted_secret, '') <> ''
  ) into v_url;
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'storage_signing_service_role_key' and coalesce(decrypted_secret, '') <> ''
  ) into v_key;
  return jsonb_build_object(
    'storage_signing_project_url', v_url,
    'storage_signing_service_role_key', v_key
  );
end;
$$;

revoke all on function public.storage_signing_secrets_present() from public, anon, authenticated;
grant execute on function public.storage_signing_secrets_present() to service_role;
