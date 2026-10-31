---
id: verdanote-no-tight-loop-supabase-db-query-linked-polling
title: Never poll prod via supabase db query --linked in tight loops — pooler circuit breaker
scope: repo
trigger: polling Verdanote prod DB state (sync progress, drain counts, job status) via the Supabase CLI
when: supabase && (db query || --linked || poll || pooler || ECIRCUITBREAKER || SASL)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-21
updated: 2026-07-21
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER poll prod via `supabase db query --linked` in tight loops: each call opens a fresh pooler auth, and repeated calls trip the Supabase pooler circuit breaker (ECIRCUITBREAKER / SASL failures), blocking ALL CLI DB access for minutes. Space queries out, batch into single combined selects, and kill leftover polling watchers.

## Rationale

Observed in a Verdanote session: a tight polling loop of `supabase db query --linked` calls tripped the pooler's circuit breaker, surfacing as ECIRCUITBREAKER / SASL authentication failures on every subsequent CLI query — including unrelated one-off queries — until the breaker reset minutes later. Because each CLI invocation performs a full pooler auth handshake, the breaker treats rapid repeats as an auth storm. Combining what you need into one select per interval, spacing intervals generously, and making sure no background watcher keeps firing avoids the lockout entirely.
