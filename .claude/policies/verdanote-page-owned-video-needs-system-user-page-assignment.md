---
id: verdanote-page-owned-video-needs-system-user-page-assignment
title: Verdanote page-owned video resolves only via the owning Page token, which the system user can mint only after the Page is ASSIGNED to it
scope: repo
trigger: resolving Verdanote page-owned (organic-post-boosted) video sources, minting Page tokens from a Meta system-user token, or diagnosing video_permission gaps
when: verdanote && (meta || page || video || token || system-user || accounts || permission || boost)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-17
updated: 2026-07-17
source: session-learning
applies_to: [meta]
---

## Rule

ALWAYS: Verdanote page-owned video (organic Page posts boosted into ads) resolves only with the owning Page's access token, and the Meta SYSTEM-USER token can mint that Page token / read the video source ONLY after the Page is ASSIGNED to the system user in Business Manager. A client sharing/partner-granting their Page to the Business Manager is necessary but NOT sufficient. /me/accounts and {system_user}/assigned_pages return only pages assigned to the system user. Flow: build page_id->token map from /me/accounts, derive page_id from object_story_spec.page_id or the effective_object_story_id prefix ({page_id}_{postid}), and retry /{video_id}?fields=source with the page token.

## Rationale

Captured from a Verdanote media-pull session. Page-owned boosted videos are not in the account-level advideos library and cannot be read with the single stored account token; they require the owning Page's token. The system user can only produce that Page token once the Page is assigned to it — mere partner/BM sharing does not surface the Page in /me/accounts or {system_user}/assigned_pages. Documenting the assignment prerequisite and the page_id->token resolution flow prevents future sessions from mislabeling these as unresolvable when the real gap is a missing Page assignment.
