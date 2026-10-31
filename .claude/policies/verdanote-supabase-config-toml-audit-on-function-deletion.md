---
id: verdanote-supabase-config-toml-audit-on-function-deletion
title: When deleting a dead Supabase function directory, also remove its [functions.X] entry from config.toml
scope: repo
trigger: deleting a `supabase/functions/<name>/` directory in verdanoteanalytics (dead-code cleanup, function consolidation, or replacement with a new function name)
enforcement: hard
public: false
version: 1
created: 2026-05-26
updated: 2026-05-26
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS audit `supabase/config.toml` for ghost `[functions.X]` entries whenever you delete a function directory under `supabase/functions/`. The directory deletion and the config-block removal must happen in the same commit — otherwise the deploy list references a non-existent path and the CLI either fails or silently skips the entry.

Pre-deploy check (run after any function-directory deletion):

```bash
# List functions declared in config.toml
grep '^\[functions\.' supabase/config.toml | sed 's/\[functions\.\(.*\)\]/\1/'

# List functions that actually exist on disk
ls -d supabase/functions/*/ | xargs -n1 basename | grep -v '^_'

# Any name in the first list but not the second is a ghost — remove its [functions.X] block from config.toml
```

## Rationale

Discovered during the verdanote dead-code cleanup checkpoint on 2026-05-26 (T-20260526-215450-verdanote-dead-code-cleanup-ccr-routine). When a function directory was deleted without auditing `config.toml`, the next `supabase functions deploy` run referenced a path that no longer existed. The Supabase CLI's deploy-all behavior reads function names from BOTH the on-disk `supabase/functions/*/` directories AND any explicit `[functions.X]` blocks in `config.toml`. A ghost block points the deploy at a missing directory.

Deletions and config entries must stay in sync. The `[functions.X]` block in `config.toml` typically carries per-function config (verify_jwt, import_map, etc.) — orphaning it leaves stale config metadata in the repo and breaks the deploy contract.
