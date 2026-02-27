
ALTER TABLE public.saved_views ADD COLUMN IF NOT EXISTS is_shared boolean DEFAULT false;
ALTER TABLE public.saved_views ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false;

-- Drop the existing restrictive policies that block shared view reads
DROP POLICY IF EXISTS "All authenticated users can view saved views" ON public.saved_views;

-- Users can see their own views + shared views from builders/employees
CREATE POLICY "Users can view own and shared views" ON public.saved_views
  FOR SELECT USING (
    auth.uid() = user_id
    OR (
      is_shared = true
      AND (has_role(auth.uid(), 'builder') OR has_role(auth.uid(), 'employee'))
    )
  );
