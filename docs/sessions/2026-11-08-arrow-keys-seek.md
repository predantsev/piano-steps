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
- 2026-11-08 PR #53 squash-merged after green CI (`ac1a2a3`); container rebuilt from `main`, `muted-notes` endpoint answers on Postgres.
- 2026-11-09 Owner: 3 s skipped several presses. Clickable prototype (claude.ai/artifact/DsyxJhF3N6ncqJCmZV4nGC); owner took steps + player-style back + longer drag = more steps, plus live scrubbing. Opened #54.
- 2026-11-09 PR #55 squash-merged after green CI (`5cd96dc`); container rebuilt from `main`.
- 2026-11-09 Owner screenshot: paused on a step, one chord note only ringed. Cause: few-ms rolled onsets vs exact-time keyboard. Opened #56.
- 2026-11-09 PR #57 squash-merged after green CI (`e2880df`; e2e "feedback dialog" flaky once, passed on retry); container rebuilt from `main`.
- 2026-11-13 iPad lost the app when the Mac's IP changed back to 192.168.0.131; switched to the Bonjour name `<mac-name>.local:9300` (works, 200). Docs issue #58.
- 2026-11-13 Committed the .local docs change on `docs/58-ipad-local-name` → PR #59; same note added to startup-rules PORTS.md → predantsev/startup-rules#39.
- 2026-11-13 PR #59 and predantsev/startup-rules#39 squash-merged (docs only, no container rebuild needed).
- 2026-11-13 Owner: held/pedalled keys stay lit and confuse. Prototypes: inline widget, then Für Elise artifact (claude.ai/artifact/5jC75Zpj7m6k1NQQykjJkY) with drain variants; owner picked "flash, then a square at the bottom" (20- 2026-11-13 Owner: held/pedalled keys stay lit and confuse. Prototypes: inline widget, then Für Elise artifact (claude.ai/artifact/5jC75Zpj7m6k1NQQykjJkY) with drain variants; owner picked "flash, then a square at the bottom" (20%). Opened #60.
