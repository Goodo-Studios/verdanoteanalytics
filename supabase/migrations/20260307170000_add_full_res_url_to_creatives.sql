-- Add full_res_url column to creatives table
-- This stores the highest-resolution image URL available from Meta's API,
-- used by the modal to display crisp images instead of compressed thumbnails.
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS full_res_url TEXT;
