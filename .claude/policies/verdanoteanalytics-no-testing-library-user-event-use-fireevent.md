---
id: verdanoteanalytics-no-testing-library-user-event-use-fireevent
title: Do not import `@testing-library/user-event` in verdanoteanalytics vitest tests
scope: repo
trigger: writing or editing a verdanoteanalytics vitest test that simulates clicks or inputs
enforcement: soft
public: false
version: 1
created: 2026-06-03
updated: 2026-06-03
source: session-learning
---

## Rule

NEVER: import `@testing-library/user-event` in verdanoteanalytics vitest tests — it isn't installed. Use `fireEvent` from `@testing-library/react` for clicks/inputs.

## Rationale

`@testing-library/user-event` is not a dependency of verdanoteanalytics, so importing it makes the test fail to resolve at run time. Use `fireEvent` from `@testing-library/react` (already available) to simulate clicks and inputs instead.
