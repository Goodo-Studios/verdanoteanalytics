-- =============================================================================
-- Creative Intelligence (WS1 / US-001) — analysis + multi-modal embeddings + tag suggestions
-- =============================================================================
-- Placeholder prefix. The orchestrator renumbers + runs `supabase db push`
-- manually (see MIGRATIONS.md). Idempotent + additive only.
--
-- Extends the account-creative pipeline so a live creative gets the same
-- transcript + framework + analysis a Creative Vault card shows, plus per-
-- dimension AI tag suggestions and separate visual/script embeddings for the
-- blended entity resolver (US-006). Analysis/vision/embedding calls route
-- through cheap OpenRouter models (US-000 lock): vision =
-- google/gemini-2.5-flash-lite, text = openai/gpt-oss-120b, embeddings =
-- openai/text-embedding-3-small @ 512d (unchanged).
--
-- Pre-existing columns reused (NOT recreated here):
--   creatives.transcript, creatives.transcript_status  (migration 20260320202048)
--   creatives.ai_analysis / ai_hook_analysis / ai_visual_notes / ai_cta_notes,
--   creatives.analysis_status, creatives.analyzed_at    (migration 20260212...)
--   creative_embeddings(ad_id pk, account_id, embedding vector(512), source_text,
--     model, ...)                                       (migration 20260714000018)
-- =============================================================================

create extension if not exists vector;

-- ─── 1. Widen analysis_status vocabulary ────────────────────────────────────
-- Existing CHECK allowed ('pending','analyzed','failed','skipped'). The
-- analyze-creative pipeline (US-002) needs to set 'analyzing' (in-flight) and
-- 'done' (complete). We drop the old constraint and re-add a SUPERSET so
-- existing rows using 'analyzed' stay valid and the pipeline can use its own
-- vocabulary. Idempotent: drop-if-exists then add-if-not-exists.
alter table public.creatives
  drop constraint if exists creatives_analysis_status_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'creatives_analysis_status_check'
  ) then
    alter table public.creatives
      add constraint creatives_analysis_status_check
      check (analysis_status in
        ('pending', 'analyzing', 'analyzed', 'done', 'failed', 'skipped'));
  end if;
end$$;

-- ─── 2. tag_suggestions — per-dimension AI suggestions (review-gated) ────────
-- Shape: { "<dimension>": { "value": text, "confidence": number 0..1,
--          "signal": "script"|"visual"|"destination"|... } }
-- Dimensions: ad_type, person, style, product, hook, theme, angle.
-- Suggestions ONLY — never written to the live tag columns without review
-- (US-010). The 'ai' tag source sits BELOW parsed in resolve-tags (US-009).
alter table public.creatives
  add column if not exists tag_suggestions jsonb;

comment on column public.creatives.tag_suggestions is
  'AI tag suggestions per dimension { value, confidence, signal }. Review-gated (US-010); never auto-promoted over manual/csv/parsed (US-009).';

-- ─── 3. Multi-modal embeddings on creative_embeddings ───────────────────────
-- v1 `embedding` = the note/text feature vector (ai_visual_notes + tags).
-- We add two dedicated 512-dim vectors so the entity resolver (US-006) can
-- blend visual + script similarity independently:
--   visual_embedding  — embedding of the vision-description text (US-000: no
--                        image embeddings in v1; we embed the description text)
--   script_embedding  — embedding of the cleaned transcript / script
-- Both produced via the existing vault-embed OpenRouter path
-- (openai/text-embedding-3-small, dimensions=512).
alter table public.creative_embeddings
  add column if not exists visual_embedding vector(512);
alter table public.creative_embeddings
  add column if not exists script_embedding vector(512);

comment on column public.creative_embeddings.visual_embedding is
  'Vision-description text embedding (512d, text-embedding-3-small). US-000: no image embeddings in v1.';
comment on column public.creative_embeddings.script_embedding is
  'Cleaned-script/transcript embedding (512d, text-embedding-3-small).';

-- HNSW cosine indexes for each new vector (mirror the existing embedding index).
create index if not exists creative_embeddings_visual_hnsw_idx
  on public.creative_embeddings
  using hnsw (visual_embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists creative_embeddings_script_hnsw_idx
  on public.creative_embeddings
  using hnsw (script_embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ─── 4. Analysis-queue helper index ─────────────────────────────────────────
-- The analyze-creative queue (US-002) drains creatives by analysis_status per
-- account; support that scan.
create index if not exists creatives_analysis_status_idx
  on public.creatives(account_id, analysis_status);
