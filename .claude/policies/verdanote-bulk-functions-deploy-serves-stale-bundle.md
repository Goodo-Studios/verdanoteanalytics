---
id: verdanote-bulk-functions-deploy-serves-stale-bundle
title: A bulk supabase functions deploy can report success while serving a stale, ungated bundle — redeploy critical functions by name and re-verify at runtime
scope: repo
trigger: after a bulk `supabase functions deploy` for verdanoteanalytics, especially Docker-less, when a security or gating change must actually be live
when: (supabase || deploy || functions) && (bundle || stale || deploy || gate || function)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-08
updated: 2026-08-08
source: session-learning
applies_to: [supabase]
---

## Rule

A bulk `supabase functions deploy` (especially Docker-less) can report success while silently serving a stale server-side bundle (old, ungated code). Redeploy critical functions explicitly by name; if a stale bundle persists, force a fresh content hash (trivial edit) and redeploy, then re-verify at runtime.

## Rationale

Captured as a verdanoteanalytics session learning. A bulk deploy that prints success is not proof every function's new bundle is being served — the server can continue serving an older bundle, which for a security change means the old, ungated code is still live. Explicit per-name redeploys, a forced content-hash change when a stale bundle sticks, and a runtime re-verification are what actually confirm the intended code shipped.
