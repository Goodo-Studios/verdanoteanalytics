---
id: verdanote-supabase-postgrest-no-dot-catch
title: Never call .catch() on a Supabase PostgrestBuilder — it is not a native Promise
scope: repo
trigger: writing or reviewing Supabase client query code (.select/.insert/.update/.upsert/.delete) in edge functions or frontend
enforcement: soft
public: false
version: 2
created: 2026-05-27
updated: 2026-06-10
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER call `.catch()` directly on a Supabase `PostgrestBuilder` — it is not a native Promise and `.catch()` throws a `TypeError` at runtime.

Always use the `await` + destructuring pattern instead:

```typescript
// WRONG — causes TypeError:
await db.from('table').insert(row).catch(err => console.error(err));

// CORRECT:
const { error } = await db.from('table').insert(row);
if (error) console.error(error);
```

This applies to all Supabase client query builders: `.select()`, `.insert()`, `.update()`, `.upsert()`, `.delete()`.

## Rationale

Captured as a session learning. PostgrestBuilder is a thenable, not a Promise — only `then` is implemented, so chained `.catch()` calls fail at runtime in exactly the error paths they were meant to protect. Converted to YAML frontmatter format 2026-06-10 during the HQ organization audit (was HTML-comment metadata).
