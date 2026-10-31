---
id: verdanote-migration-number-off-remote-frontier
title: Number new Supabase migrations off the remote frontier, not the latest local file
scope: repo
trigger: Creating or numbering a new verdanoteanalytics Supabase migration, or hitting a duplicate-version collision / out-of-order db push failure
when: supabase && migration
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 3
created: 2026-07-18
updated: 2026-08-03
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS check BOTH the local migrations directory's newest file AND the remote frontier (`supabase migration list --linked` for the highest applied version) before numbering a new migration — number off whichever is higher. Two distinct failure directions both come from checking only one side:

- **Local behind remote** (the original case below): concurrent work elsewhere already pushed higher-numbered migrations to prod, so numbering off the local newest file collides with or falls behind the remote frontier. `db push` refuses to insert a migration numbered behind the remote frontier without `--include-all`; `git mv` the local stragglers up to the frontier before pushing.
- **Local ahead of remote**: an unpushed migration is already sitting in the local working tree, newer than anything on the remote frontier. Numbering off the remote frontier here would collide with (or land behind) that unpushed local migration — the local newest file is the correct base to number after in this case.

Same collision arises from parallel worktree agents: when parallel worktree agents each branch off main, they pick the SAME next migration number off the remote frontier and collide (two `20260723000002` files). Renumber off the remote frontier again at merge time before applying/merging the second branch.

## Rationale

Concurrent work in another chat pushed `20260717xxx` migrations to prod while a local branch was still on `20260714xxx`, producing a duplicate-version collision (two files at `...032`) and out-of-order `db push` failures. Because `db push` will not insert a migration numbered behind the remote frontier without `--include-all`, the fix was to `git mv` the straggler migrations up to the frontier. Numbering off the latest LOCAL file — instead of the remote applied frontier — is what let the local branch fall behind and collide. The converse also happens: numbering strictly off the remote frontier while ignoring an already-present unpushed local migration causes the same class of collision from the other direction. Checking both and taking the max avoids either failure mode. Companion policies: [[verdanote-db-push-matches-by-version-number-collision-skips]] and [[verdanote-supabase-migration-numbering-order-before-references]].
