---
id: goodo-studios-verdanote-deno-tests-allow-read
title: Verdanote Deno function tests require read permission
scope: repo
when: verdanote && deno && test
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-09-27
updated: 2026-09-27
source: session-learning
tags: [verdanote, deno, testing, edge-functions]
---

## Rule

ALWAYS: Run Verdanote Deno function tests with `--allow-read` in addition to `--allow-env` and `--allow-net` because regression tests inspect source files and migrations.

## Rationale

Verdanote's function regression suite reads implementation and migration files as test inputs. Omitting filesystem read permission causes permission failures that do not reflect a product regression.
