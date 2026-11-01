---
id: verdanote-vault-pipeline-enter-at-transcribe-not-analyze
title: Verdanote vault AI pipeline must enter at vault-transcribe, never vault-analyze directly
scope: repo
trigger: triggering or wiring the Verdanote Creative Vault AI pipeline (transcribe/analyze)
enforcement: soft
public: false
version: 2
created: 2026-06-02
updated: 2026-06-03
source: session-learning
---

## Rule

ALWAYS: For VIDEO creatives, the Verdanote vault AI pipeline must enter at vault-transcribe, never vault-analyze directly. vault-analyze (video path) REQUIRES an existing inspiration_transcripts.raw_transcript row and throws/clobbers item state if absent. Never insert a blank transcript — vault-analyze treats falsy transcript as missing and re-triggers transcription, causing an infinite self-heal loop. Static image / non-video creatives are the exception: vault-save routes them straight to vault-analyze, which runs an image-only vision branch with NO transcript row required (see verdanote-vault-analyze-image-only-branch-no-transcript).

## Rationale

Captured as a session learning during a Verdanote Creative Vault ship. For VIDEO creatives, `vault-analyze` depends on a populated `inspiration_transcripts.raw_transcript` row; calling it without one throws and clobbers item state. A blank/empty transcript does not help — `vault-analyze` treats a falsy transcript as missing and re-triggers transcription, which loops. Always enter the VIDEO pipeline at `vault-transcribe`. Static image / non-video creatives are handled differently: `vault-save` routes them directly to `vault-analyze`, which runs an image-only vision branch (single Sonnet vision call → framework + brand + visual/copy analysis) keyed on `isImageOnlyAnalysis` and does NOT require a transcript row — so image ads are analyzed, not skipped. See `verdanote-vault-analyze-image-only-branch-no-transcript` for the image-only branch detail.
