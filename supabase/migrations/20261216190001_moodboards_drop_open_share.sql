-- Drop the open moodboard share policies (audit plan item 1.3).
--
-- The two policies from 20260228000125 had no TO clause, so anon and every signed-in user could
-- list every shared moodboard and its items without a link. Nothing in the app or the edge
-- functions uses moodboards (no public page, no code outside the generated types), so nothing
-- needs a replacement lookup. Staff keep access through "Builder/employee can manage moodboards"
-- and "Builder/employee can manage moodboard_items".

DROP POLICY IF EXISTS "Public can view shared moodboards" ON public.moodboards;
DROP POLICY IF EXISTS "Public can view shared moodboard items" ON public.moodboard_items;
