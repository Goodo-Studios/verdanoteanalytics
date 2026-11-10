-- Parent foreign keys the staff pages embed through (migration 20261110200004).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Regression for PGRST200 on the Deliverables, QA gates and Handoffs pages: every
-- history table a page embeds under its parent must have a single-column foreign key
-- to that parent, or PostgREST cannot follow it. The pairs below are the embeds the
-- pages use (src/features/deliverables, qa-gates and handoffs).

BEGIN;
SELECT plan(9);

CREATE TEMP TABLE embeds (child regclass, parent regclass);
INSERT INTO embeds VALUES
  ('public.engagement_deliverable_revisions', 'public.engagement_deliverables'),
  ('public.engagement_deliverable_decisions', 'public.engagement_deliverables'),
  ('public.engagement_deliverable_round_exceptions', 'public.engagement_deliverables'),
  ('public.engagement_deliverable_confirmations', 'public.engagement_deliverables'),
  ('public.engagement_deliverable_qa_returns', 'public.engagement_deliverables'),
  ('public.engagement_deliverable_signoffs', 'public.engagement_deliverables'),
  ('public.approval_subject_versions', 'public.approval_subjects'),
  ('public.approval_subject_decisions', 'public.approval_subjects'),
  ('public.handoff_acknowledgements', 'public.handoff_packets');

SELECT ok(EXISTS (SELECT 1 FROM pg_constraint c
                   WHERE c.contype = 'f' AND c.conrelid = e.child AND c.confrelid = e.parent AND cardinality(c.conkey) = 1),
          format('%s has a single-column foreign key to %s', e.child, e.parent))
  FROM embeds e ORDER BY e.child::text;

SELECT * FROM finish();
ROLLBACK;
