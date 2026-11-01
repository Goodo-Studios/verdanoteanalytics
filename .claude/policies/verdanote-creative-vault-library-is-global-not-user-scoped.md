---
id: verdanote-creative-vault-library-is-global-not-user-scoped
title: Creative Vault library (inspiration_items) is global, not user-scoped
scope: repo
trigger: "Creative Vault, inspiration_items, save-ad-to-vault, swipe-file, analytics ad saving"
enforcement: hard
public: false
version: 1
created: 2026-05-30
updated: 2026-05-30
source: user-correction
---

## Rule

For Verdanote, the Creative Vault library (`inspiration_items`) is GLOBAL — readable by all authenticated users — not user-scoped as the creative-vault-merge PRD stated. Saved analytics ads land in the shared library visible to everyone.

## Rationale

The creative-vault-merge PRD described `inspiration_items` as user-scoped, but the actual data model is a shared library: any authenticated user can read every item. When building features that save creatives into the vault (e.g. save-ad-to-vault), do not assume per-user isolation — saved ads are visible to the whole team.
