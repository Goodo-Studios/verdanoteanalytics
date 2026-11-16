-- Audit Batch 9 (storage tests): the inspiration-media bucket was made by hand in the production
-- dashboard and is in no migration, so local test stacks and new environments do not have it and
-- the Vault upload path cannot be tested. Create it with the production settings: private, no
-- size limit, no type list (production-check 2026-11-15). In production it already exists, so
-- this changes nothing there. Its storage policies are in 20260527000006.

INSERT INTO storage.buckets (id, name, public)
VALUES ('inspiration-media', 'inspiration-media', false)
ON CONFLICT (id) DO NOTHING;
