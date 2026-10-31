---
id: verdanote-deploy-edge-fn-before-frontend-for-new-query-param
title: Deploy the edge function before the verdanoteanalytics frontend when a change sends a new query param
scope: repo
trigger: A verdanoteanalytics frontend change starts sending a NEW query param to an edge function (e.g. useAllCreatives `?all=1`)
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
applies_to: [vercel, supabase]
---

## Rule

ALWAYS, when a verdanoteanalytics frontend change sends a NEW query param to an edge function (e.g. useAllCreatives `?all=1`), deploy the edge fn BEFORE the frontend (edge ships via CI on merge to main; frontend is manual vercel after). Frontend-first means the old edge fn ignores the param and silently falls back (e.g. limit=100 → truncated data).

## Rationale

Edge functions deploy automatically via CI on merge to main, while the frontend is a manual `vercel --prod` afterward. If the frontend ships first with a new query param, the still-old edge function does not recognize the param and silently falls back to its default behavior (e.g. `limit=100`), producing truncated or wrong data with no error. Deploying the edge function first (merge it to main so CI ships it) guarantees the param is honored by the time the frontend that sends it goes live.
