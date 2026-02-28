
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS digest_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS digest_day text DEFAULT 'monday',
ADD COLUMN IF NOT EXISTS digest_accounts text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS last_digest_sent_at timestamptz DEFAULT NULL;
