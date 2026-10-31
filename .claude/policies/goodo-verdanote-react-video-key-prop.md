---
id: goodo-verdanote-react-video-key-prop
title: React `<video>` elements that swap sources need a unique `key` prop
scope: repo
trigger: Editing React components in the Verdanote app (or any Goodo product) where a `<video>` element's `src` changes based on a selected item — modals, carousels, creative previews, etc.
enforcement: soft
public: false
version: 1
created: 2026-05-20
updated: 2026-05-20
source: session-learning
---

## Rule

ALWAYS pass `key={uniqueField}` (e.g. `key={ad.id}` or `key={creative.url}`) to React `<video>` elements when the same component instance can render different videos over its lifetime — most commonly inside creative modals, ad detail panes, and gallery viewers.

If the `<video>` only ever renders one source for the lifetime of the surrounding component (e.g. a static homepage hero), the `key` is unnecessary.

## Rationale

React's reconciler matches sibling elements by position+type. Without a `key`, swapping the parent's selected item reuses the **same DOM `<video>` node** and only mutates the `src` attribute. The HTML media element does not auto-reload on `src` change — the browser keeps showing the previous (often paused, often the wrong) frame, and `play()` may resolve against the stale source.

Giving each instance a unique `key` forces React to unmount the old `<video>` and mount a new one, which triggers a fresh media-element lifecycle (`load()` → metadata → first frame). This is the same pattern used for `<iframe src>`, `<audio src>`, and other media elements whose imperative state isn't driven by props alone.

Caught during the Verdanote creative-modal video-URL preview work — switching ads in the modal continued to show the previous ad's video until the modal was closed and reopened.
