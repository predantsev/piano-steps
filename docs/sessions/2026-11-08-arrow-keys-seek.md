# 2026-11-08 — Falling notes: arrow keys seek 3 s

Session: 0de39e0c-3cd0-4c44-bb39-9eb446b8e2ce

## Goal

Follow-up to #44 / PR #45: in falling notes, plain ← / → should move 3 s back / forward inside the
fragment being practised; switching fragments moves to Shift + ← / →.

## Log

- 2026-11-08 Opened #46. Owner confirmed reading (a): ← / → seek ±3 s; "switch and play" moved to ⌥ + ← / → (default, no preference given).
- 2026-11-08 Committed the previous session's journal + decisions, and the feature (`PracticeEngine.seek`, guide en+uk, CHANGELOG, unit + e2e tests) on `feat/46-arrow-seek`.
- 2026-11-08 PR #47 squash-merged after green CI (`87301f0`); container rebuilt from `main`. Not checked on a real iPad.
- 2026-11-08 Owner asked for touch seeking on the iPad; clarified that 👁 Ahead only sets how far ahead you see. Interactive mockup of four options (claude.ai/artifact/JZiDSbbRaY8pKgTbR13W7g), owner picked C (swipe). Opened #48.
- 2026-11-08 Committed the swipe seek (#48) on `feat/48-swipe-seek`: sideways swipe on the lane = ±3 s, bar tap decided on release.
- 2026-11-08 PR #49 squash-merged after green CI (`b02f148`); container rebuilt from `main`. Not checked on a real iPad.
- 2026-11-08 Owner: 29 fragments wrapped the chips over several lines on the iPad. Opened #50 — chips on one line, ‹ › scroll when they overflow.
- 2026-11-08 PR #51 squash-merged after green CI (`3f8799b`); container rebuilt from `main`.
- 2026-11-08 Owner idea: learn a lighter version first by switching single notes off. Mockup (claude.ai/artifact/VtXrB25HJfCgjd1QHE1nyF), owner picked G1 (dashed outline). Opened #52.
