---
id: verdanote-supabase-link-per-working-directory-worktree
title: Supabase CLI link is per-working-directory — re-link a worktree before db push / migrations
scope: repo
trigger: Running Verdanote db push / migration list from a git worktree, or seeing the project read as unlinked outside the primary tree
when: supabase && (link || worktree || push || migration)
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

supabase CLI link is per-working-directory (supabase/.temp/), so a git worktree needs its own `supabase link --project-ref <ref>` before db push / migration list work — the primary tree's link does not carry over. Verdanote project ref = gwyxaqoaldnaavkjqquv.

## Rationale

Captured as a session learning. The Supabase CLI stores link state under the working directory's `supabase/.temp/`, so a git worktree does not inherit the primary tree's link. Running `db push` or `migration list` from an unlinked worktree fails or targets the wrong project; run `supabase link --project-ref gwyxaqoaldnaavkjqquv` in the worktree first. Complements [[verdanote-supabase-functions-deploy-from-changed-worktree]] (deploy bundles from CWD) and [[verdanote-source-env-for-supabase-linked-deploy]] (source .env for the access token).
