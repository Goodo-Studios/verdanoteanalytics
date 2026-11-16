-- settings is builder only (audit plan item 1.4).
--
-- The table holds meta_access_token, gemini_api_key and app_password. "Employee can read settings"
-- (20260518000001) let every employee read them through PostgREST. Nothing in the app reads
-- settings directly: the Settings page uses the builder-only settings function (service role,
-- values masked), and the other readers are service-role edge functions. Builders keep
-- "Builder can manage settings".

DROP POLICY IF EXISTS "Employee can read settings" ON public.settings;
