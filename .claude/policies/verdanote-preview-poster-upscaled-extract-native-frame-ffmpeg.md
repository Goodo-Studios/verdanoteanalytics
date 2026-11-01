---
id: verdanote-preview-poster-upscaled-extract-native-frame-ffmpeg
title: Free preview-capture posters are upscaled thumbs — extract a native-res frame with ffmpeg
scope: repo
trigger: Investigating soft/blurry Verdanote library poster images, or regenerating creative posters
when: poster || preview || ffmpeg || video_url
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-23
updated: 2026-07-23
source: session-learning
---

## Rule

Verdanote free preview-capture stores the ad-preview iframe's poster image (often Meta's tiny 64x64 thumb) UPSCALED onto a 1080 canvas — reports HD but renders soft — while the captured video is only 360-720p. To get crisp library posters, extract a native-res frame from the captured video with ffmpeg (edge runtime can't decode video → run local/worker). scripts/regenerate-video-posters.mjs does this, only upgrading when the frame beats the current poster. video_url starting with http = a real captured file.

## Rationale

Captured as a session learning. The stored poster is a tiny Meta thumbnail upscaled to a 1080 canvas, so it reports HD dimensions but renders soft; the real image data lives in the captured video. Extracting a native-resolution frame with ffmpeg (which must run local/worker because the edge runtime can't decode video) produces a crisp poster. `scripts/regenerate-video-posters.mjs` implements this and only upgrades when the extracted frame beats the current poster; a `video_url` starting with `http` indicates a real captured file to extract from.
