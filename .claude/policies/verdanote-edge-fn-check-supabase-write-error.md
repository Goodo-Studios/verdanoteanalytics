---
id: verdanote-edge-fn-check-supabase-write-error
title: Check { error } on every supabase-js state-stamping write
scope: repo
when: supabase && (edge || function || sync_logs || last_synced_at)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-10-02
updated: 2026-10-02
source: session-learning
---

## Rule

ALWAYS: In Verdanote edge functions, destructure and check { error } from every supabase-js write that stamps state (last_data_sync, last_synced_at, sync_logs). supabase-js returns errors instead of throwing, so an unchecked update leaves an account looking never-synced with no log entry.

## Rationale

Silent write failures made accounts appear never-synced with no sync_logs trace.
