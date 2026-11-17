-- Document uploads for Knowledge, the Brain and the client Brand doc (BID).
--
-- Staff (builder or employee) upload a document: the text goes into the existing table for that
-- area (client_bids, knowledge_sources, brain_pages) and the original file goes into a private
-- storage bucket. Clients never see any of it: every table rule and storage rule below needs
-- builder or employee, the same staff-only pattern as the Vault (20261216530001).
--
--   storage bucket staff-documents   private, 10 MB limit, markdown / text / PDF / Word only.
--                                    Paths are <area>/<uuid>/<file name>, area = bid | knowledge | brain.
--                                    Staff read, add and delete; nobody updates.
--   staff_document_files             one row per stored original file, linked to the BID, knowledge
--                                    source or Brain page it came with. Staff read; written only by
--                                    the three functions below.
--   add_client_bid                   staff add a BID version for a client (source 'upload').
--   upload_knowledge_document        staff add a knowledge source with a category and optional client.
--   upload_brain_page                staff add a Brain page to one of the four sections. The page is
--                                    marked edited in the app, so scripts/publish-brain.mjs keeps it.
--
-- Additive changes to existing rules: client_bids.source also allows 'upload'; the text limit of
-- a knowledge version goes from 20,000 to 200,000 characters (the same limit a Brain page has).
-- No data is changed or removed.
-- Tests: supabase/tests/staff_document_uploads_test.sql.

-- ------------------------------------------------------------------ private bucket

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-documents', 'staff-documents', false, 10485760,
  ARRAY['text/markdown', 'text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY staff_documents_staff_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

CREATE POLICY staff_documents_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'staff-documents'
    AND (storage.foldername(name))[1] IN ('bid', 'knowledge', 'brain')
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

CREATE POLICY staff_documents_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND ((SELECT public.has_role((SELECT auth.uid()), 'builder'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'employee'::public.app_role)))
  );

-- ------------------------------------------------------------------ file records

CREATE TABLE public.staff_document_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL CHECK (area IN ('bid', 'knowledge', 'brain')),
  target_id uuid NOT NULL,
  file_path text NOT NULL UNIQUE CHECK (length(file_path) BETWEEN 8 AND 400),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  mime_type text NOT NULL CHECK (mime_type IN (
    'text/markdown', 'text/plain', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (file_path LIKE area || '/%')
);
CREATE INDEX staff_document_files_target_idx ON public.staff_document_files (area, target_id);

COMMENT ON TABLE public.staff_document_files IS 'Original files uploaded with a BID, knowledge source or Brain page (private bucket staff-documents). Staff read; written only by the upload functions.';

ALTER TABLE public.staff_document_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_document_files FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.staff_document_files TO authenticated;
GRANT ALL ON TABLE public.staff_document_files TO service_role;

CREATE POLICY "Builder/employee can read staff_document_files" ON public.staff_document_files
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'builder'::public.app_role) OR public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ existing rules, widened

-- client_bids.source also allows 'upload'.
DO $drop$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.client_bids'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%source = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE public.client_bids DROP CONSTRAINT %I', c.conname);
  END LOOP;
END;
$drop$;
ALTER TABLE public.client_bids
  ADD CONSTRAINT client_bids_source_check CHECK (source IN ('bid-builder', 'staging-seed', 'upload'));

-- A knowledge version may hold up to 200,000 characters (was 20,000), for uploaded documents.
DO $drop$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.knowledge_source_versions'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%length(btrim(body))%'
  LOOP
    EXECUTE format('ALTER TABLE public.knowledge_source_versions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END;
$drop$;
ALTER TABLE public.knowledge_source_versions
  ADD CONSTRAINT knowledge_source_versions_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 200000);

-- ------------------------------------------------------------------ shared check

CREATE OR REPLACE FUNCTION public.assert_staff_document_file(p_area text, p_path text, p_name text, p_mime text, p_size bigint)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_path IS NULL THEN
    RETURN;
  END IF;
  IF p_path NOT LIKE p_area || '/%' OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
     OR p_mime IS NULL OR p_mime NOT IN ('text/markdown', 'text/plain', 'application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
     OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'check the uploaded file' USING errcode = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_staff_document_file(text, text, text, text, bigint) FROM public, anon, authenticated;

-- ------------------------------------------------------------------ BID

CREATE OR REPLACE FUNCTION public.add_client_bid(
  p_client_slug text,
  p_title text,
  p_body_markdown text,
  p_file_path text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_size_bytes bigint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sha text;
  v_id uuid;
  v_version integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'builder'::public.app_role) OR public.has_role(auth.uid(), 'employee'::public.app_role)) THEN
    RAISE EXCEPTION 'only staff can add a BID' USING errcode = 'insufficient_privilege';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_body_markdown IS NULL OR length(btrim(p_body_markdown)) NOT BETWEEN 1 AND 400000 THEN
    RAISE EXCEPTION 'check the BID fields' USING errcode = '22023';
  END IF;
  PERFORM public.assert_staff_document_file('bid', p_file_path, p_file_name, p_mime_type, p_size_bytes);
  PERFORM 1 FROM public.clients WHERE slug = p_client_slug FOR SHARE;
  IF NOT found THEN
    RAISE EXCEPTION 'client not found' USING errcode = 'P0002';
  END IF;
  v_sha := encode(sha256(convert_to(p_body_markdown, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext('client_bids:' || p_client_slug));
  SELECT id INTO v_id FROM public.client_bids WHERE client_slug = p_client_slug AND body_sha256 = v_sha;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.client_bids WHERE client_slug = p_client_slug;
  INSERT INTO public.client_bids (client_slug, version, title, body_markdown, body_sha256, source, source_ref, data_origin, generated_at)
  VALUES (p_client_slug, v_version, btrim(p_title), p_body_markdown, v_sha, 'upload', coalesce(nullif(btrim(p_file_name), ''), 'pasted text'), 'real', now())
  RETURNING id INTO v_id;
  IF p_file_path IS NOT NULL THEN
    INSERT INTO public.staff_document_files (area, target_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
    VALUES ('bid', v_id, p_file_path, btrim(p_file_name), p_mime_type, p_size_bytes, auth.uid());
  END IF;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------ Knowledge

CREATE OR REPLACE FUNCTION public.upload_knowledge_document(
  p_title text,
  p_body text,
  p_category text,
  p_client_slug text DEFAULT NULL,
  p_file_path text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_size_bytes bigint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_client text := nullif(btrim(p_client_slug), '');
BEGIN
  IF NOT (public.has_role(auth.uid(), 'builder'::public.app_role) OR public.has_role(auth.uid(), 'employee'::public.app_role)) THEN
    RAISE EXCEPTION 'only staff can add knowledge' USING errcode = 'insufficient_privilege';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 200000
     OR p_category IS NULL OR p_category !~ '^[a-z][a-z0-9_-]{0,39}$' THEN
    RAISE EXCEPTION 'check the document fields' USING errcode = '23514';
  END IF;
  PERFORM public.assert_staff_document_file('knowledge', p_file_path, p_file_name, p_mime_type, p_size_bytes);
  IF v_client IS NOT NULL THEN
    PERFORM 1 FROM public.clients WHERE slug = v_client;
    IF NOT found THEN
      RAISE EXCEPTION 'client not found' USING errcode = 'P0002';
    END IF;
  END IF;
  INSERT INTO public.knowledge_sources (title, namespace, classification, release_scope, client_slug, created_by)
  VALUES (btrim(p_title), p_category, 'staff', CASE WHEN v_client IS NULL THEN 'global' ELSE 'client' END, v_client, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.knowledge_source_versions (source_id, version, body, fingerprint, kind, published_by)
  VALUES (v_id, 1, p_body, public.knowledge_body_fingerprint(p_body), 'create', auth.uid());
  IF p_file_path IS NOT NULL THEN
    INSERT INTO public.staff_document_files (area, target_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
    VALUES ('knowledge', v_id, p_file_path, btrim(p_file_name), p_mime_type, p_size_bytes, auth.uid());
  END IF;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------ Brain

CREATE OR REPLACE FUNCTION public.upload_brain_page(
  p_section text,
  p_title text,
  p_body_md text,
  p_owner text DEFAULT NULL,
  p_file_path text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_size_bytes bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'builder'::public.app_role) OR public.has_role(auth.uid(), 'employee'::public.app_role)) THEN
    RAISE EXCEPTION 'only staff can add a Brain page' USING errcode = 'insufficient_privilege';
  END IF;
  IF p_section IS NULL OR p_section NOT IN ('Handbook', 'Playbooks', 'Clients', 'Insights')
     OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_body_md IS NULL OR length(btrim(p_body_md)) NOT BETWEEN 1 AND 200000 THEN
    RAISE EXCEPTION 'check the page fields' USING errcode = '23514';
  END IF;
  PERFORM public.assert_staff_document_file('brain', p_file_path, p_file_name, p_mime_type, p_size_bytes);
  v_base := trim(both '-' from regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'));
  IF v_base = '' THEN
    v_base := 'document';
  END IF;
  v_base := left(v_base, 80);
  v_slug := v_base;
  PERFORM pg_advisory_xact_lock(hashtext('brain_pages:' || p_section));
  WHILE EXISTS (SELECT 1 FROM public.brain_pages WHERE section = p_section AND slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;
  INSERT INTO public.brain_pages (id, section, slug, title, body_md, owner, last_reviewed, last_reviewed_source, source_path, content_hash,
                                  edited_in_app, edited_at, edited_by)
  VALUES (v_id, p_section, v_slug, btrim(p_title), p_body_md, coalesce(nullif(btrim(p_owner), ''), 'Unassigned'), current_date, 'upload',
          'app-upload/' || v_id::text, encode(sha256(convert_to(p_body_md, 'UTF8')), 'hex'), true, now(), auth.uid());
  IF p_file_path IS NOT NULL THEN
    INSERT INTO public.staff_document_files (area, target_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
    VALUES ('brain', v_id, p_file_path, btrim(p_file_name), p_mime_type, p_size_bytes, auth.uid());
  END IF;
  RETURN jsonb_build_object('id', v_id, 'slug', v_slug, 'section', p_section);
END;
$$;

REVOKE ALL ON FUNCTION public.add_client_bid(text, text, text, text, text, text, bigint),
  public.upload_knowledge_document(text, text, text, text, text, text, text, bigint),
  public.upload_brain_page(text, text, text, text, text, text, text, bigint)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_client_bid(text, text, text, text, text, text, bigint),
  public.upload_knowledge_document(text, text, text, text, text, text, text, bigint),
  public.upload_brain_page(text, text, text, text, text, text, text, bigint)
  TO authenticated, service_role;
