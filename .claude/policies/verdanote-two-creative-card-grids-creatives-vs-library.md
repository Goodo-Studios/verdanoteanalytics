---
id: verdanote-two-creative-card-grids-creatives-vs-library
title: Confirm which creative card grid (Creatives vs Creative Library) before editing
scope: repo
trigger: Editing a Verdanote creative card grid component, or a change described against the "Creatives" or "Creative Library" page
when: creatives || CardGrid || LibraryCard || creative-library
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-23
updated: 2026-07-23
source: session-learning
---

## Rule

Verdanote has TWO near-identical creative card grids: the 'Creatives' page uses src/components/creatives/CreativesCardGrid.tsx, the 'Creative Library' page uses src/features/creative-library/components/LibraryCard.tsx (feature dir). Confirm which page the user means before editing — they look the same but are different components. The screenshot header 'Every live creative for this account — playable, classified, and archivable' = Creative Library = LibraryCard.

## Rationale

Captured as a session learning. The two grids render nearly identically, so editing the wrong component silently changes the wrong page. Disambiguating by the page name (or the "Every live creative for this account…" header, which maps to Creative Library / LibraryCard) before editing prevents wasted changes and misdirected fixes.
