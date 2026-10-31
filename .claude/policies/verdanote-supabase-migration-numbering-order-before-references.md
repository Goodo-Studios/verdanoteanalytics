---
id: verdanote-supabase-migration-numbering-order-before-references
title: Order Supabase migrations so columns apply before the plpgsql body that references them
scope: repo
trigger: Adding a new Supabase migration that creates columns AND a separate migration whose RPC/plpgsql body references those columns, especially when two migrations collide on the same timestamp prefix
enforcement: soft
public: false
version: 1
created: 2026-05-30
updated: 2026-05-30
source: success-pattern
applies_to: [supabase]
---

## Rule

Before applying a batch of new Supabase migrations, run `supabase migration list --linked` and verify the local migration filenames are uniquely numbered and ordered so that any migration creating a column applies strictly before any migration whose plpgsql/RPC body references that column.

When two new migrations share the same timestamp prefix (a numbering collision), renumber them — do not rely on filesystem or alphabetical tie-breaking. Assign the schema/DDL migration (e.g. `ADD COLUMN`) the earlier number and the function/RPC migration (e.g. `CREATE OR REPLACE FUNCTION ... <new column>`) a later number. A collision left unresolved silently reorders the apply sequence and surfaces as a `column "<name>" does not exist` failure when the plpgsql body runs before its columns exist.

Catch this from the `supabase migration list` output before `supabase db push`, not from a failed production apply.

## Rationale

During `frame-retention-curves`, the columns migration and the `bulk_update_creative_metrics` RPC migration both landed at prefix `20260530210000`. The collision was caught from `supabase migration list` output before it caused a missing-column failure; the columns migration was renumbered to `210002` and the RPC migration to `210003` so the columns apply before the plpgsql body that references them. Supabase applies migrations in lexical filename order, so a same-prefix collision makes the apply order undefined — verifying uniqueness and dependency ordering up front turns a production apply failure into a one-line rename.
