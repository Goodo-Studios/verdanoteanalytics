---
id: verdanote-supabase-shared-module-edit-redeploy-all-importers
title: Editing a Supabase _shared/ module requires redeploying every edge function that imports it
scope: repo
trigger: modifying any file under verdanoteanalytics `supabase/functions/_shared/` (parsers, auth helpers, shared utilities)
enforcement: soft
public: false
version: 1
created: 2026-05-31
updated: 2026-05-31
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: editing a Supabase `_shared/` module means redeploying EVERY edge function that imports it — shared code bundles at deploy time, so a function still on disk with the old import keeps running stale code until it is redeployed. Grep the import path before deploying so no function is left behind:

```bash
# Find every function that imports the changed shared module
grep -rl "_shared/<module>" supabase/functions/ | xargs -n1 dirname | sort -u
```

Deploy all of those functions, not just the one you were working in.

## Rationale

Supabase edge functions are bundled at deploy time: the contents of an imported `_shared/` module are inlined into each function's deployment artifact. Editing the shared file on disk has no effect on already-deployed functions — they continue executing the version of the shared code that was bundled at their last deploy. A change that looks complete locally (or under `supabase functions serve`, which reads from disk) will silently apply to only the functions you happened to redeploy, leaving every other importer on stale logic. Grepping the import path enumerates the full blast radius so the redeploy set is complete.
