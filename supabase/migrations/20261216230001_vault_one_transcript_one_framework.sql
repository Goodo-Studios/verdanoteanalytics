-- One transcript and one framework per Vault item (audit plan item 4.3).
--
-- Re-analysis inserted a new inspiration_frameworks row each time, and a repeated Apify webhook
-- could insert a second inspiration_transcripts row. vault-analyze reads the transcript with
-- .single(), which fails on two rows, and the item page showed whichever row came back first.
--
-- 1. Remove duplicates, keeping the newest row per item (created_at, then id as a tie-break).
--    Production on 2026-11-15 (read-only check): 1 item with 2 transcripts, no duplicate frameworks.
-- 2. Add unique(item_id) to both tables. The functions upsert on item_id from now on.
-- Safe to run twice: the deletes find nothing the second time and the constraints are guarded.

delete from public.inspiration_transcripts t
using (
  select id, row_number() over (partition by item_id order by created_at desc, id desc) as rn
  from public.inspiration_transcripts
) ranked
where t.id = ranked.id and ranked.rn > 1;

delete from public.inspiration_frameworks f
using (
  select id, row_number() over (partition by item_id order by created_at desc, id desc) as rn
  from public.inspiration_frameworks
) ranked
where f.id = ranked.id and ranked.rn > 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inspiration_transcripts_item_id_key') then
    alter table public.inspiration_transcripts add constraint inspiration_transcripts_item_id_key unique (item_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inspiration_frameworks_item_id_key') then
    alter table public.inspiration_frameworks add constraint inspiration_frameworks_item_id_key unique (item_id);
  end if;
end $$;

-- The unique constraints index item_id, so the old plain indexes are redundant.
drop index if exists public.inspiration_transcripts_item_idx;
drop index if exists public.inspiration_frameworks_item_idx;
