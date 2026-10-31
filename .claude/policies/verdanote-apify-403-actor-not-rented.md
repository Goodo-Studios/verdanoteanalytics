---
id: verdanote-apify-403-actor-not-rented
title: Apify 403 actor-is-not-rented is not a token auth error
scope: repo
trigger: when handling Apify API error responses in vault-extract or any Verdanote edge function
enforcement: soft
public: false
version: 1
created: 2026-06-08
updated: 2026-06-08
source: session-learning
applies_to: [apify]
---

## Rule

NEVER treat an Apify 403 `actor-is-not-rented` response as an `APIFY_TOKEN` authentication error. The vault-extract 401/403 handler conflates token auth failures with actor rental errors. Add an explicit check for `actor-is-not-rented` in the response body and surface a distinct error message (e.g. "Actor requires a paid rental plan").

## Rationale

A 403 from Apify can mean either an invalid/missing token (auth failure) or that the actor requires rental and the account has not rented it. Conflating these leads to misleading "check your APIFY_TOKEN" error messages when the real issue is that the actor is paywalled. The fix is a body-string check before the generic 4xx handler.
