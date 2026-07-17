-- =============================================================================
-- Creative Intelligence (WS1 / US-002 fix) — add transcript columns to creatives
-- =============================================================================
-- Placeholder prefix. Idempotent + additive only.
--
-- US-001 (migration 032) and the PRD assumed creatives already had `transcript` /
-- `transcript_status`. It does NOT — those columns live on ad_library_saved_ads
-- (migration 20260320202048). The analyze-creative pipeline writes a cleaned
-- transcript back onto the account creative for Vault parity, so creatives needs
-- them too. Same shape/defaults as the ad_library_saved_ads columns.
-- =============================================================================

alter table public.creatives
  add column if not exists transcript text;
alter table public.creatives
  add column if not exists transcript_status text not null default 'none';

comment on column public.creatives.transcript is
  'Cleaned transcript from the analyze-creative pipeline (Groq Whisper -> cleanup). Mirrors ad_library_saved_ads.transcript for Vault parity.';
comment on column public.creatives.transcript_status is
  'none | ready — set by analyze-creative when a transcript is produced.';
