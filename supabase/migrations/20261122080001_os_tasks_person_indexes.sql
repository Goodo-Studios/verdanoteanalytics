-- Goodo OS story OS-009: My work.
--
-- The My work page reads a person's open tasks in one request:
--   os_tasks where strategist_id = me or producer_id = me or editor_id = me, status <> 'complete'.
-- One index per person column lets Postgres answer the OR with a bitmap OR of three index scans
-- instead of reading the whole table. No data, grant or row rule changes.

create index if not exists os_tasks_strategist_id_idx on public.os_tasks (strategist_id);
create index if not exists os_tasks_producer_id_idx on public.os_tasks (producer_id);
create index if not exists os_tasks_editor_id_idx on public.os_tasks (editor_id);
