-- Add hook_visual text column to inspiration_frameworks so the visual hook
-- (what the viewer sees in the first 3s) can be stored alongside hook_verbal
-- and hook_text. The existing hook_visual_saved boolean on inspiration_items
-- flags whether this hook has been starred into the Hook Library.

alter table inspiration_frameworks
  add column if not exists hook_visual text;
