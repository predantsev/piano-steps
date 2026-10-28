# Change log

Every change that reaches the app is logged here: **what** changed and **why**, newest first,
with its issue and PR. Rule and checklist: AGENTS.md § "Change log and the guide".

## 2026-10-28

- **Stable note ids; tap a falling note to report it** (#30). Every note now has a stable `id`
  (given by the server, kept on edits; old lessons are back-filled on start). In Falling notes,
  tapping a bar pauses, sounds the note and opens a menu: Hear it · Sounds wrong (higher / lower /
  extra / missing / timing / other + comment) · Fix it myself (later). The report stores the note id
  and a copy of the note. ⚑ Sounds wrong now lists the lesson's earlier reports with their status
  and the agent's note. *Why:* the owner wants to point at the exact wrong note while listening and
  come back to it later with an agent; until now a report named only a fragment and the app never
  showed what became of it. Cards and Sheet + keys are unchanged for now.

- **The guide lives in the database** (#29). The "How to use it" text moved from the web code
  into the `guides` table, one record per language, read with `GET /api/guide?lang=` and
  replaced by agents with `PUT /api/guide/{lang}`. The repo keeps one English example
  (`packages/core/src/guide/guide.en.json`), seeded on first start. *Why:* the owner wants the
  guide edited by agents through the API, Ukrainian kept only in his database, and a plain
  example for anyone installing the app. Docs: `docs/guide.md`.
- **In-app guide, left-before-right hands, bigger ⚙** (#27, PR #28). A **?** button opens a guide
  covering the flow, every view, Wait for me, keys, sound on an iPad, lessons and what "Sounds
  wrong" really does. The falling view's hands read Both | Left | Right. ⚙ and ? are 48 px. *Why:*
  the owner could not tell how to move on without a keyboard, what "Sounds wrong" does, the hand
  buttons were mirrored against the keyboard, and ⚙ was too small for a finger.

## 2026-10-24

- **Playback and sound on a real iPad** (#25, PR #26). The audio unlock retries on every gesture
  (not once, on `pointerdown`), resumes after an iOS interruption, shows "Tap to enable sound"
  instead of a silent freeze, and plays through the iPad's silent switch
  (`navigator.audioSession.type = 'playback'`, or a silent `<audio>` loop on older iOS). *Why:* on
  the iPad the falling notes stopped at the first note with no sound — the audio context never
  started, so the player clock stood still; later the sound was muted by the silent switch.
