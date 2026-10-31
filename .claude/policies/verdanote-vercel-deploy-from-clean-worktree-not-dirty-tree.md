---
id: verdanote-vercel-deploy-from-clean-worktree-not-dirty-tree
title: Deploy verdanoteanalytics frontend from a clean worktree of origin/main, never vercel --prod from a dirty tree
scope: repo
trigger: Running `vercel --prod` for the verdanoteanalytics frontend — especially when the working tree has uncommitted changes
enforcement: soft
public: false
version: 2
created: 2026-06-02
updated: 2026-08-08
source: session-learning
applies_to: [vercel]
when: vercel && (deploy || worktree || prod || frontend)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
---

## Rule

ALWAYS deploy the verdanoteanalytics frontend from a CLEAN git worktree of origin/main (`git worktree add --detach /tmp/x origin/main` + copy `.vercel/` in), never `vercel --prod` from the working tree — `vercel --prod` bundles whatever is in the cwd, so a dirty tree ships uncommitted WIP to prod. Then verify the live bundle (new index-<hash>.js + grep the served route/shared chunk for a marker of the change).

The Verdanote frontend does NOT auto-deploy on merge — deploy with `vercel --prod`. To deploy `main` without disturbing a working tree that is checked out to another branch, use `git worktree add --detach <tmp> origin/main`, copy the gitignored `.vercel/project.json` in, run vercel there, then `git worktree remove`. Copying the gitignored `.vercel/project.json` is what links the detached worktree to the right Vercel project.

## Rationale

`vercel --prod` uploads and builds whatever sits in the current working directory, not the committed state of origin/main. Deploying from a dirty working tree therefore silently ships any uncommitted, unreviewed WIP straight to production. Deploying from a freshly checked-out clean worktree of origin/main guarantees prod matches what was reviewed and merged. The post-deploy bundle verification (new `index-<hash>.js` plus grepping the served route/shared chunk for a marker of the change) confirms the intended change actually shipped.
