---
id: verdanoteanalytics-wait-cron-cycle-after-edge-function-deploy
title: Wait at least one cron cycle after deploying a Supabase edge function before assuming new version is live
scope: repo
trigger: just ran `supabase functions deploy` for a Verdanote sync-related edge function and need to verify new behavior
enforcement: soft
public: false
version: 1
created: 2026-05-26
updated: 2026-05-26
source: session-learning
applies_to: [supabase]
---

## Rule

After running `supabase functions deploy <fn>` for a Verdanote sync-related edge function, ALWAYS wait at least one full cron cycle (2 minutes for Verdanote) before assuming the new code is what's running. Do not interpret behavior observed inside that window as evidence the deploy succeeded — or failed.

## Rationale

Supabase reports `supabase functions deploy` as complete before the new version has fully propagated to all worker instances. A cron tick that fires during the propagation window can still hit the previously-deployed version, producing logs and side effects from the old code. Treating those as "the new deploy is broken" leads to spurious rollbacks; treating them as "the new deploy works" leads to false confidence.

The 2-minute Verdanote cron interval is a convenient natural fence: skip one full tick after deploy, then read logs from the next tick onward.

## Examples

**Correct:**

```
$ supabase functions deploy sync-orchestrator
Deployed Function sync-orchestrator on project xxx
$ sleep 120  # let one cron tick fire on the old version first
$ # now check logs — anything from this point is the new version
```

**Incorrect:**

```
$ supabase functions deploy sync-orchestrator
Deployed Function sync-orchestrator on project xxx
$ # immediately check next cron tick — may still be the old version
```
