---
id: verdanote-filter-meta-handlebars-placeholders
title: Filter Meta Handlebars template vars from Facebook ad copy before storing
scope: repo
trigger: ingesting or storing Facebook ad copy text (title, transcript, body)
enforcement: soft
public: false
version: 1
created: 2026-06-05
updated: 2026-06-05
source: session-learning
---

## Rule

ALWAYS: Filter Meta Handlebars template vars (containing `{{`) from Facebook ad copy before storing as item title or transcript. Dynamic catalog ads embed unresolved `{{product.brand}}` placeholders that must never reach the UI or analysis pipeline.

## Rationale

Facebook dynamic catalog ads use Handlebars-style template variables (e.g. `{{product.brand}}`, `{{product.name}}`) in their ad copy. The Apify scraper captures these before Meta resolves them. If stored verbatim, they appear as literal strings in the UI and break downstream analysis (LLM prompts, search, tagging). Strip or skip any ad body/title/transcript field that contains `{{`.
