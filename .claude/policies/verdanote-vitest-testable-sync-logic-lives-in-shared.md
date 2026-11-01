---
id: verdanote-vitest-testable-sync-logic-lives-in-shared
title: In verdanoteanalytics, vitest-testable sync/coverage logic must live in Deno-free _shared/*.ts, not sync/index.ts
scope: repo
trigger: Adding or testing sync/coverage logic in verdanoteanalytics supabase edge functions that must be vitest-testable
when: verdanoteanalytics && (vitest || sync || coverage || _shared)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-16
updated: 2026-07-16
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: in verdanoteanalytics, pure sync/coverage logic that must be vitest-testable lives in supabase/functions/_shared/*.ts (Deno-free); supabase/functions/sync/index.ts touches Deno at module load so tests never import it directly — they either import from _shared or read the source as text (see syncPhaseErrorHandling.test.ts / carouselFrameCoverage.test.ts).

## Rationale

Captured as a verdanoteanalytics session learning. `sync/index.ts` touches Deno at module load, so a vitest test that imports it directly crashes on Deno globals. Keeping the pure sync/coverage logic in Deno-free `supabase/functions/_shared/*.ts` lets tests import it directly, and where logic can only live in `index.ts`, tests read the source as text instead of importing it (as in `syncPhaseErrorHandling.test.ts` / `carouselFrameCoverage.test.ts`).
