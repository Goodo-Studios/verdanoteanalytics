---
id: verdanote-diff-dirty-tree-against-origin-main-before-commit
title: Diff a dirty verdanoteanalytics working tree against origin/main before committing or deploying
scope: repo
trigger: A verdanoteanalytics working tree has uncommitted changes you're about to commit or deploy, while parallel sessions/PRs may have been in flight
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
---

## Rule

ALWAYS, before committing/deploying a dirty verdanoteanalytics working tree, diff it against origin/main first — parallel sessions/PRs may have already merged the same WIP. This session's "uncommitted WIP" was almost entirely already merged via #23–#28; committing it again created duplicate commits that collapsed on merge.

## Rationale

In a multi-session/multi-PR workflow, a working tree's "uncommitted changes" are not necessarily new — other sessions or PRs may have already landed the same work on origin/main. Committing those changes again produces duplicate commits that later collapse (and create noise/conflicts) at merge time. Diffing the dirty tree against origin/main first reveals what is genuinely new versus already-merged, so only real WIP gets committed.
