---
id: verdanote-parse-all-actions-before-new-meta-calls
title: Check what sync already fetches — actions[] carries every conversion event already
scope: repo
trigger: Proposing new Meta API calls, fields, or breakdowns for Verdanote, or adding conversion metrics
when: meta || insights || sync || actions || action_values || parseInsightsRow || conversion
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-01
updated: 2026-08-01
source: session-learning
applies_to: [supabase, meta]
---

## Rule

ALWAYS check what Verdanote already fetches before proposing new Meta calls: sync/index.ts requests only 16 ad-level insights fields and ZERO breakdowns. Critically, actions[] and action_values[] are already fetched and contain EVERY conversion event, but parseInsightsRow extracts only purchase, add_to_cart and (goal-gated) onsite_conversion.flow_complete — initiate_checkout, lead, complete_registration, view_content, subscribe and custom conversions are silently discarded. Parsing them is free (no new API call, no extra quota) and is the cheapest available win, especially for non-ecommerce accounts with no purchase pixel.

## Rationale

Captured 2026-08-01 while scoping Meta capability expansion. New Meta fields and breakdowns cost app-wide rate-limit budget that sync already competes for, so the first question is always whether the data is already in hand. It is: the insights response already carries the full actions[]/action_values[] arrays, and the loss happens locally in parseInsightsRow. Accounts without a purchase pixel currently look conversion-dead purely because of that local filter, not because Meta withheld anything.
