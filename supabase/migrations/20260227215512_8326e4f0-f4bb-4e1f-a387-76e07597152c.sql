CREATE POLICY "Users can delete own conversations"
  ON public.ai_conversations FOR DELETE
  USING (user_id = auth.uid());