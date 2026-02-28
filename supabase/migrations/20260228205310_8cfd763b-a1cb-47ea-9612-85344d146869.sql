
-- Add thumbnail_storage_path column to creatives table
ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS thumbnail_storage_path text;

-- Add index for efficient queries on creatives missing cached thumbnails
CREATE INDEX IF NOT EXISTS idx_creatives_thumb_storage_null 
  ON public.creatives (account_id) 
  WHERE thumbnail_url IS NOT NULL 
    AND thumbnail_url != 'no-thumbnail' 
    AND thumbnail_storage_path IS NULL;
