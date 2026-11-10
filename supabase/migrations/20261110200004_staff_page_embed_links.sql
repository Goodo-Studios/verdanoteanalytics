-- Fix: the Deliverables, QA gates and Handoffs pages (step 4b) could not load on
-- staging. Each page reads a parent row with its history in one request, for example
-- handoff_packets with handoff_acknowledgements(*). PostgREST embeds a child table only
-- through a foreign key to the parent, and these history tables pointed only at the
-- revision or version row (a two-column key), not at the parent itself, so the request
-- failed with PGRST200 ("Could not find a relationship"). Seen on staging 2026-11-10
-- for handoff_packets, approval_subjects and engagement_deliverables.
--
-- Each history table gains a plain foreign key to its parent. The values are already
-- there (the column is the first half of the existing two-column key), so no row
-- changes and every existing rule still holds. Nothing here is visible to clients.
-- Tests: supabase/tests/staff_page_embed_links_test.sql.

alter table public.engagement_deliverable_decisions
  add constraint engagement_deliverable_decisions_deliverable_fkey
  foreign key (deliverable_id) references public.engagement_deliverables(id) on delete restrict;
alter table public.engagement_deliverable_round_exceptions
  add constraint engagement_deliverable_round_exceptions_deliverable_fkey
  foreign key (deliverable_id) references public.engagement_deliverables(id) on delete restrict;
alter table public.engagement_deliverable_confirmations
  add constraint engagement_deliverable_confirmations_deliverable_fkey
  foreign key (deliverable_id) references public.engagement_deliverables(id) on delete restrict;
alter table public.engagement_deliverable_qa_returns
  add constraint engagement_deliverable_qa_returns_deliverable_fkey
  foreign key (deliverable_id) references public.engagement_deliverables(id) on delete restrict;
alter table public.engagement_deliverable_signoffs
  add constraint engagement_deliverable_signoffs_deliverable_fkey
  foreign key (deliverable_id) references public.engagement_deliverables(id) on delete restrict;
alter table public.approval_subject_decisions
  add constraint approval_subject_decisions_subject_fkey
  foreign key (subject_id) references public.approval_subjects(id) on delete restrict;
alter table public.handoff_acknowledgements
  add constraint handoff_acknowledgements_packet_fkey
  foreign key (packet_id) references public.handoff_packets(id) on delete restrict;

notify pgrst, 'reload schema';
