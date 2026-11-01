---
id: verdanote-check-branch-before-reasoning-shared-primary-worktree
title: In verdanoteanalytics, run git branch --show-current before reasoning about "what is on main" — the primary worktree is shared and can be switched mid-session
scope: repo
trigger: reasoning about a verdanoteanalytics repo's tracked/untracked files or "what is on main", especially around migrations
when: verdanoteanalytics && (branch || worktree || main || migration || tracked)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-16
updated: 2026-07-16
source: session-learning
---

## Rule

ALWAYS: before reasoning about a repo's tracked/untracked files or 'what is on main', run `git branch --show-current` first. The verdanoteanalytics primary worktree is SHARED and can be switched to another dev's active branch mid-session (e.g. feature/creative-intelligence). I mislabeled migrations 032/033 as 'untracked' when the worktree had silently been switched onto a branch where they were tracked — cost real time and produced a wrong statement to the user.

## Rationale

Captured as a verdanoteanalytics session learning. The primary worktree is a shared checkout, so its current branch is not a stable assumption — another dev (or an earlier step) can switch it onto a feature branch, changing which files are tracked. Verifying the current branch first prevents mislabeling tracked files as untracked and prevents wrong statements to the user.
