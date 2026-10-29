# Change log

Every change that reaches the app is logged here: **what** changed and **why**, newest first,
with its issue and PR. Rule and checklist: AGENTS.md § "Change log and the guide".

## 2026-10-29

- **Notes on fragments** (#40). In Falling notes, a **Note** button (current fragment) and holding /
  right-clicking any fragment number open a note: free text, **Come back later**, and wishes for
  re-cutting (too hard — split · merge with the next · boundary is wrong). Numbers show a pencil and a
  bookmark; the ⚑ window gets a **Notes on fragments** tab with a "come back later" filter and Done.
  Stored in `fragment_notes` (one per fragment, by position), API `GET …/fragment-notes`,
  `PUT|DELETE …/fragments/{position}/note`. Guide updated in en and uk. *Why:* while checking a lesson
  fragment by fragment, the owner wants to mark one he is unsure about and come back to it later
  (with an agent), and to note how fragments should be cut (#33). Picked variant A of a clickable mockup.

- **Correction: the gap between same-pitch notes does not reveal split held notes** (#37). The
  knowledge-base note and the `/transcribe` sanity check written earlier today said "a gap under 30–50 ms
  = a held note split into re-strikes". An audio check showed those are mostly real repeated notes under
  the pedal (merging by gap would have deleted 61 % of the notes). Now: look for a missing attack (no
  energy rise at that pitch) and fix only in a copy, checked by ear. *Why:* the earlier rule would have
  led the next session to destroy correct notes.
- **Known transcription flaw written down: held notes drawn as several presses** (#37). A knowledge-base
  note and a sanity check in the `/transcribe` skill. *Why:* on "Люди як кораблі" the owner heard held
  notes drawn as several presses; the next song's session should look for it from the start.

## 2026-10-28

- **The guide moved back into the repo, in both languages** (#35). `guide.en.json` and
  `guide.uk.json` in `packages/core/src/guide` are the source of truth, bundled into the app (works
  offline); a test keeps their sections in step. `PUT /api/guide/{lang}` still works but saves a
  **temporary override** (table `guide_overrides`), flagged by `GET /api/guides` and on server start
  until it is moved into the file and `DELETE`d. *Why:* the whole UI is bilingual in code, so the
  guide belongs next to it — versioned with the features it describes, reviewed in the same PR, and
  not lost with the database; the API path stays for quick fixes.

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
