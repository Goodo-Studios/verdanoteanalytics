---
id: verdanote-source-env-for-supabase-linked-deploy
title: Source .env before Supabase deploy so Verdanote project reads as linked
scope: repo
trigger: deploying Verdanote Supabase (db push, deploy-functions.sh) or running supabase CLI against project gwyxaqoaldnaavkjqquv
enforcement: soft
public: false
version: 2
created: 2026-05-30
updated: 2026-07-18
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: To deploy Verdanote Supabase, `set -a && source .env && set +a` in repos/private/verdanoteanalytics first — SUPABASE_ACCESS_TOKEN in .env is what makes the active account see project gwyxaqoaldnaavkjqquv as LINKED. Without it `supabase projects list` truncates Verdanote out.

Sourcing the repo `.env` this way (`set -a; source .env; set +a`) is the prescribed path for a sanctioned linked deploy and does NOT expose secret values into the agent context — never `cat`/print the file contents, but sourcing it for `db push` / functions deploy is fine.

## Rationale

Captured as a session learning during a Verdanote ship. The `SUPABASE_ACCESS_TOKEN` in `repos/private/verdanoteanalytics/.env` authenticates the active account against the Verdanote org; without it sourced into the environment, the CLI does not see project `gwyxaqoaldnaavkjqquv` as linked and `supabase projects list` truncates Verdanote out of the results, so `db push`/function deploys fail. Run `set -a && source .env && set +a` from the main checkout before any Supabase deploy command.
