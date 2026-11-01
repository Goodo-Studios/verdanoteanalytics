---
id: verdanote-feature-branches-live-in-sibling-worktree
title: In verdanoteanalytics, feature branches often live in a sibling worktree, not the main tree
scope: repo
trigger: Working on a verdanoteanalytics feature branch (e.g. feature/meta-media-completeness) whose files appear missing from the main repo tree
when: verdanoteanalytics && (worktree || branch || feature)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-16
updated: 2026-07-16
source: session-learning
---

## Rule

ALWAYS: in verdanoteanalytics, feature branches (e.g. feature/meta-media-completeness) are often checked out in a sibling git worktree (verdanoteanalytics-wt-<branch>), NOT the main repo tree which sits on main. Run `git worktree list` first and work in the matching worktree — the main tree will be missing the branch's files.

## Rationale

Captured as a verdanoteanalytics session learning to prevent working against the wrong tree. The main repo tree stays on main, so a feature branch's files only exist in its sibling worktree; editing or searching the main tree for those files silently misses them. Running `git worktree list` first and working in the matching `verdanoteanalytics-wt-<branch>` worktree ensures changes land where the branch actually lives.
