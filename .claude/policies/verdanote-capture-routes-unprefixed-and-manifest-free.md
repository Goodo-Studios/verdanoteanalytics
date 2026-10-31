---
id: verdanote-capture-routes-unprefixed-and-manifest-free
title: Verdanote phone capture routes are deliberately un-prefixed and manifest-free
scope: repo
trigger: Touching /capture/quick-add or /capture/share-target routing, the role prefix scheme, or the vercel.json rewrite order
when: capture || manifest || share_target || quick-add
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-08
updated: 2026-08-08
source: session-learning
applies_to: [vercel]
---

## Rule

Verdanote's phone capture routes (/capture/quick-add, /capture/share-target) are deliberately un-prefixed — outside the /builder|/employee|/client role prefix. The OS opens these paths verbatim from the manifest share_target or a home-screen bookmark, so the path cannot vary by role, and staying outside the role-prefixed app shell keeps them light on a phone connection. /capture/quick-add is additionally served from its own manifest-free document via a vercel.json rewrite ordered before the SPA catch-all.

## Rationale

These are not routes that were missed when the role prefix scheme was applied — the absence of a prefix is the design. The operating system opens them verbatim from the manifest's `share_target` entry or from a home-screen bookmark, both of which bake in a fixed path at install time. A role-varying path cannot be expressed there, so the route has to be stable and role-independent. Keeping them outside the role-prefixed app shell also avoids pulling the full shell down over a phone connection for what is meant to be a fast capture.

The `/capture/quick-add` rewrite in `vercel.json` must stay ordered before the SPA catch-all. Its whole purpose is to serve a separate, manifest-free document so iOS Add to Home Screen targets that page instead of the app's manifest `start_url`; if the catch-all matches first, the manifest-bearing SPA document is served and the standalone home-screen behavior silently reverts. Anyone reordering the rewrites or "tidying" these routes under a role prefix will break both the OS share target and the home-screen icon.
