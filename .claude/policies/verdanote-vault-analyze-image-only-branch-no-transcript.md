---
id: verdanote-vault-analyze-image-only-branch-no-transcript
title: Verdanote vault-analyze has an image-only branch that must not require a transcript row
scope: repo
trigger: working on the Verdanote Creative Vault vault-save / vault-analyze pipeline, especially for non-video (static image) uploads
enforcement: soft
public: false
version: 1
created: 2026-06-03
updated: 2026-06-03
source: session-learning
---

## Rule

ALWAYS: Verdanote Creative Vault pipeline branches by media kind — vault-save routes non-video uploads straight to vault-analyze, which must NOT require an inspiration_transcripts row. Static image ads have no spoken script; vault-analyze runs an image-only branch (single Sonnet vision call → framework + brand + visual/copy analysis) keyed on isImageOnlyAnalysis (no transcript AND media_kind==='image' or file_path has image ext). A transcription-failed VIDEO has neither signal so it still surfaces the transcript error.

## Rationale

Captured as a session learning during a Verdanote Creative Vault ship. The earlier model treated any missing transcript as a video transcription failure, which broke static image ads (they have no spoken script to transcribe). The fix branches by media kind: vault-save sends non-video uploads directly to vault-analyze, and vault-analyze detects the image-only case via `isImageOnlyAnalysis` (no transcript AND `media_kind === 'image'` or an image file extension) and runs a single Sonnet vision call producing framework + brand + visual/copy analysis — no `inspiration_transcripts` row required. The signal is precise enough that a genuinely transcription-failed video (no transcript and not an image) does not match the image-only branch, so it still surfaces the transcript error as expected.
