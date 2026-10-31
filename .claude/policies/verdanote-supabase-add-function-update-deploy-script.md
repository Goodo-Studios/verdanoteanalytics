---
id: verdanote-supabase-add-function-update-deploy-script
title: When adding a new Supabase edge function to verdanoteanalytics, add it to scripts/deploy-functions.sh in the same commit
scope: repo
trigger: creating a new `supabase/functions/<name>/` directory in verdanoteanalytics (new feature, new webhook handler, new background job, etc.)
enforcement: hard
public: false
version: 1
created: 2026-05-28
updated: 2026-08-02
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS add the new function name to `scripts/deploy-functions.sh` in the same commit that creates `supabase/functions/<name>/`. The script is the explicit deploy manifest — Supabase CI/CD only ships functions named in it. A new directory without a matching entry in the script will pass tests, pass review, and merge to main, but will never reach production.

Pre-commit check (run after any new function directory is added):

```bash
# List functions that exist on disk
ls -d supabase/functions/*/ | xargs -n1 basename | grep -v '^_' | sort > /tmp/disk-functions.txt

# List functions named in the FUNCTIONS=(...) array in deploy-functions.sh
# (the script loops `for fn in "${FUNCTIONS[@]}"` — it does not contain a
# literal `supabase functions deploy <name>` line per function, so a plain
# grep for that string matches nothing and falsely reports every function
# as a gap)
awk '/^FUNCTIONS=\(/{f=1; next} f && /^\)/{f=0} f' scripts/deploy-functions.sh \
  | sed 's/#.*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | awk 'NF' | sort > /tmp/deployed-functions.txt

# Any name in the first list but not the second is a silent deploy gap
comm -23 /tmp/disk-functions.txt /tmp/deployed-functions.txt
```

If `comm` returns any lines, the commit is incomplete — add those names to `scripts/deploy-functions.sh` before pushing.

## Rationale

Discovered during a verdanoteanalytics feature deploy where a newly added edge function shipped to main but never deployed — invocations 404'd in production while staging/local Supabase calls worked because `supabase functions serve` reads from disk. The deploy script (`scripts/deploy-functions.sh`) is a hand-maintained explicit allowlist, not a `for f in supabase/functions/*/` loop. This is deliberate: the script controls which functions are part of the production surface, and lets dev-only or experimental functions live on disk without auto-deploying. The trade-off is that *addition* requires two synchronized edits — the function code AND the deploy manifest — or the new code is invisible to prod.

Symmetric to [[verdanote-supabase-config-toml-audit-on-function-deletion]], which covers the deletion side of the same lifecycle: that policy guards against ghost entries (manifest names a function that no longer exists on disk), this policy guards against orphan directories (disk has a function the manifest never deploys). Both failure modes are silent — no CLI error, no CI red, just a function that doesn't exist in production until someone tries to call it.
