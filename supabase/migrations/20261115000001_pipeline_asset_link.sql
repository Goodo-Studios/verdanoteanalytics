-- Client view, phase 5b: the review link on cards.
--
-- Owner decision 2026-11-10: the ClickUp custom field "Link to Asset" (text, id
-- 43b89e72-8575-49e6-bf6a-fc90f373291c, the same id in every client Project View list) holds the
-- link into Air that a client may open. sync-clickup-tasks copies it into asset_link on both card
-- tables, after checking it (_shared/air-link.ts: https, and an air.inc host or subdomain).
--
-- The database repeats that check as a constraint, so a row written any other way still cannot hold
-- a javascript: address, an http address or a look-alike host. The value is null when the field is
-- empty or fails the check.
--
-- Who reads it: the same row rules as before. A client reads asset_link of its own clients' cards
-- (pipeline_tasks and pipeline_delivered); staff read every card's. Nothing writes it from the
-- browser. No grant or policy changes: both tables already expose all columns to the rows a client
-- may read, and asset_link is meant to be one of them.
--
-- Staff must paste the client-shareable Air link into that field. An internal Air link pasted there
-- would be visible to the client; the host check cannot tell the two apart.
--
-- Tests: supabase/tests/pipeline_asset_link_test.sql.

alter table public.pipeline_tasks
  add column asset_link text;
alter table public.pipeline_delivered
  add column asset_link text;

alter table public.pipeline_tasks
  add constraint pipeline_tasks_asset_link_air_only
  check (asset_link is null or (length(asset_link) <= 500 and asset_link ~ '^https://([a-z0-9-]+\.)*air\.inc([/?#][^[:space:]]*)?$'));
alter table public.pipeline_delivered
  add constraint pipeline_delivered_asset_link_air_only
  check (asset_link is null or (length(asset_link) <= 500 and asset_link ~ '^https://([a-z0-9-]+\.)*air\.inc([/?#][^[:space:]]*)?$'));

comment on column public.pipeline_tasks.asset_link is
  'Air review link from the ClickUp "Link to Asset" field. https and an air.inc host only (checked by the sync and by a constraint). Shown to the client as "View asset".';
comment on column public.pipeline_delivered.asset_link is
  'Air review link from the ClickUp "Link to Asset" field. https and an air.inc host only. Shown to the client as "View asset".';
