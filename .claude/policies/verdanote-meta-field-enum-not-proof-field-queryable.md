---
id: verdanote-meta-field-enum-not-proof-field-queryable
title: Meta SDK field enum is not proof a field is queryable — probe for silent omission
scope: repo
trigger: Planning or reviewing any new Meta Marketing API field for Verdanote (insights, account-level scores, creative diversity/fatigue signals)
when: meta || insights || adsinsights || creative_diversity || creative_fatigue || opportunity_score
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-01
updated: 2026-08-01
source: session-learning
applies_to: [meta]
---

## Rule

NEVER trust the facebook-python-business-sdk AdsInsights Field enum as proof a field is queryable. Probed 2026-08-01 across all 24 Goodo-connected ad accounts at level=account/ad/campaign over last_7d/30d/90d: creative_diversity_score, creative_diversity_label and creative_diversity_data are ACCEPTED by the API (no error) but the key is ABSENT from every response row. Meta's Creative Entity ID is internal-only and the diversity score is its Ads-Manager-only proxy. Measured availability on the same roster: creative_fatigue_summary 9/24, creative_fatigued_ads 1/24 (and empty), AdAccount.opportunity_score 18/24 (values 0-97), creative_media_type 24/24. Silent field omission — not an error — is how Meta signals 'not rolled out to this account'.

## Rationale

Captured from a live API probe session (2026-08-01) while scoping the creative-diversity project. The SDK enum is generated from Meta's full internal field catalogue, so it lists fields that no external app can actually read. Because Meta answers an unavailable field with a 200 and simply omits the key, a plan built off the enum looks correct in code review and only fails as permanently-null columns in production. The only reliable test is an empirical probe across the real account roster, and the measured per-account hit rates above are what any capability plan must be sized against.
