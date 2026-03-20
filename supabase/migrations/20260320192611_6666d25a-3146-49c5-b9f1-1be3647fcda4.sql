
INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-media', 'ad-media', true)
ON CONFLICT (id) DO NOTHING;
