---
id: verdanote-reassert-branch-and-refspec-push-shared-tree
title: Verdanote — re-assert branch and push with explicit refspec in verdanoteanalytics (shared tree drifts)
scope: repo
trigger: any git mutation (commit/push) in repos/private/verdanoteanalytics, whose working tree is shared by concurrent sessions and the menubar
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
---

## Rule

ALWAYS: re-assert the current branch immediately before EVERY git mutation in repos/private/verdanoteanalytics and push with an explicit refspec (`git push origin <branch>`). Its working tree is shared by concurrent sessions/menubar and drifts between branches mid-task (a commit landed on a stray branch this session; the tree was found on three different branches across the session). Bare `git push` from a drifted branch tracking origin/main can target main.

This is the verdanoteanalytics-specific instance of the general technique in `hq-git-branch-verify` (verify branch before committing) and `hq-git-push-refspec-chip-safe` (pin commits with detached-HEAD + refspec when a tree may be swapped mid-stream). The drift source here is not only task chips but concurrent interactive sessions and the menubar operating on the same shared tree, so re-verify on every mutation, not just once per task.

## Rationale

Captured during a Verdanote session where the `repos/private/verdanoteanalytics` working tree was observed on three different branches across one session, and a commit landed on a stray branch. The tree is shared by concurrent sessions and the menubar Sync, so the local branch pointer can move between any two of your git calls. A bare `git push` from a drifted branch whose upstream is `origin/main` can silently push to main. Re-reading `git branch --show-current` immediately before each mutation and always pushing `origin <branch>` (never bare) is the verdanote-specific guardrail.
