---
id: verdanote-meta-advideos-map-underdiagnoses-page-permission
title: Verdanote Meta advideos-map video resolution under-diagnoses Page-permission failures as video_unresolved
scope: repo
trigger: diagnosing Verdanote Meta video coverage, video_unresolved vs video_permission labeling, or account-level video-source gaps
when: verdanote && (meta || advideos || video || permission || coverage || token || page)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-16
updated: 2026-07-16
source: session-learning
applies_to: [meta]
---

## Rule

NOTE: Verdanote resolves Meta video sources via an account-level advideos map on a single stored token (no Page tokens). This under-diagnoses Page-permission failures: page-owned videos absent from the advideos library return empty (not an explicit #10 error) and get mislabeled video_unresolved instead of video_permission. Portfolio snapshot 2026-07-16: 1,593 video_permission + 15,173 video_unresolved of 26,665 eligible ads (17.5% covered). act_1233881692132906 = 0% video coverage (systemic token/Page-access gap).

## Rationale

Captured so future sessions understand why video_unresolved counts are inflated relative to true video_permission failures, and recognize account-level zero-coverage (e.g. act_1233881692132906) as a systemic token/Page-access gap rather than isolated missing media.
