---
id: verdanote-supabase-functions-deploy-from-changed-worktree
title: Deploy Supabase edge functions from the worktree that actually contains the changes
scope: repo
trigger: Running `supabase functions deploy` for verdanoteanalytics, especially when feature work lives in a sibling worktree/branch and the deploy is run from a different checkout
when: verdanoteanalytics && (supabase || functions || deploy) && (worktree || branch || bundle)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-21
updated: 2026-07-21
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS deploy Supabase edge functions from the worktree/branch that actually contains the changes — `supabase functions deploy` bundles from the current working directory's `supabase/functions`. Deploying from a different checkout (e.g. the primary repo dir on another branch) silently ships stale code; verify the uploaded asset list includes your changed `_shared` files.

## Rationale

`supabase functions deploy` packages whatever is on disk under the current working directory's `supabase/functions`, not the committed state of any particular branch. When feature work lives in a sibling worktree/branch (see [[verdanote-feature-branches-live-in-sibling-worktree]]) but the deploy command is run from the primary checkout that is still on another branch, the CLI happily bundles and ships the old code — the deploy reports success while the intended change never reaches prod. Run the deploy from the worktree that holds the changes, and confirm the uploaded asset list in the CLI output includes the changed `_shared` files as a positive check that the correct bundle went up.
