---
id: verdanote-ci-deploy-edge-fn-transient-522-esm-sh
title: CI "Deploy Supabase edge functions" can transiently 522 on esm.sh — re-run and verify your fns deployed
scope: repo
trigger: A red Verdanote CI "Deploy Supabase edge functions" job, especially with an esm.sh 522 import error
when: deploy || CI || functions || esm.sh
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-23
updated: 2026-07-23
source: session-learning
applies_to: [supabase]
---

## Rule

verdanoteanalytics CI 'Deploy Supabase edge functions' can transiently FAIL on `Import https://esm.sh/@supabase/supabase-js@2 failed: 522` (Cloudflare timeout) for a few unrelated functions mid-batch; the deploy script continues and only the 522'd functions are skipped (they keep their prior main-matching code, no regression). Re-run the workflow or let the next merge redeploy to clear the red. Verify YOUR changed functions show 'Deployed' (not skipped) in the log.

## Rationale

Captured as a session learning. The 522 is a Cloudflare timeout fetching `esm.sh`, not a code fault; the deploy script continues past it and only the affected functions are skipped, keeping their prior main-matching code (no regression). Re-running the workflow or letting the next merge redeploy clears the red. The load-bearing check is confirming that YOUR changed functions show 'Deployed' — not skipped — in the deploy log.
