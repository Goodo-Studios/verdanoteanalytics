-- annotations bucket: no uploads or deletes by signed-in users (audit plan item 1.2).
--
-- The two policies from 20260228040046 only checked bucket_id, so any signed-in user could add
-- files and delete anyone's file. With public sign-up on, that is anyone. Nothing in the app or
-- the edge functions uses annotations today, so they are dropped rather than rewritten. If the
-- feature is built, add an upload rule then; do not copy the read rule onto INSERT, because it
-- needs a matching annotations row that does not exist yet at upload time.
--
-- The account-scoped read policy (20260808000002) stays. The service role is unaffected.

DROP POLICY IF EXISTS "Auth users can upload annotations" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete own annotations" ON storage.objects;
