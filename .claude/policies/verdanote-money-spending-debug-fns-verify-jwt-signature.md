---
id: verdanote-money-spending-debug-fns-verify-jwt-signature
title: Debug edge functions that can spend money must verify the JWT signature (never trust decoded claims with verify_jwt=false) and be undeployed after use
scope: repo
trigger: writing a temporary/debug Supabase edge function that starts paid runs or spends money, or setting verify_jwt=false in config.toml
when: verify_jwt || (debug && (deploy || edge))
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: hard
public: false
version: 1
created: 2026-07-22
updated: 2026-07-22
source: task-completion
applies_to: [supabase]
---

## Rule

NEVER gate a money-spending edge function (one that can start paid Apify runs, paid
API calls, etc.) on a decoded-but-unverified JWT claim when `verify_jwt = false` is
set in config.toml: with verification off, the gateway forwards ANY bearer, so an
attacker can mint an unsigned JWT with `{"role":"service_role"}` and pass a
claims-only check. Verify the JWT signature server-side (or use an
exact-match shared secret). Additionally, ALWAYS undeploy temporary spike/debug
functions immediately after the spike concludes — do not leave paid-run-starting
endpoints deployed.

## Rationale

US-000 spike (2026-07-22): the temporary `apify-spike` function used a claims-only
role check with `verify_jwt = false`; QA flagged the forgeability and the function
was undeployed immediately after verification. Its code remains on
`feature/apify-creative-capture` and must gain signature verification before any
redeploy.
