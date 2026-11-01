---
id: verdanote-shadcn-dialog-width-override-same-tailwind-variant
title: Override shadcn DialogContent width with the same Tailwind variant as its default
scope: repo
trigger: widening or resizing a shadcn Dialog/DialogContent in the Verdanote frontend, or any width class that does not visibly apply
when: DialogContent || (dialog && (max-w || width)) || tailwind-merge
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-21
updated: 2026-07-21
source: session-learning
---

## Rule

ALWAYS override shadcn DialogContent width with the SAME Tailwind variant as its default (`sm:max-w-…`): the default is `sm:max-w-lg`, and tailwind-merge only dedupes within a variant group, so a base `max-w-5xl` / `max-w-[1280px]` silently never applies. Verify with `twMerge` directly when a width change does not visibly land.

## Rationale

The Verdanote modal stayed capped at 512px through multiple "widening" attempts because the override used base (unvariant) `max-w-*` classes while the component default is `sm:max-w-lg`. tailwind-merge deduplicates conflicting classes only within the same variant group, so the base class and the `sm:` class coexist and the `sm:` default wins at desktop widths. Passing `sm:max-w-5xl` (matching the default's variant) resolves it; running the class strings through `twMerge` directly is the fastest way to confirm which class survives.
