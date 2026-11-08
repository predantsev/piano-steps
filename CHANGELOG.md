# Change log

Every change that reaches the app is logged here: **what** changed and **why**, newest first,
with its issue and PR. Rule and checklist: AGENTS.md § "Change log and the guide".

## 2026-11-08

- **Falling notes: swipe sideways on the lane to move 3 s** (#48). Right = 3 s forward, left = 3 s
  back, the same as ← / →. A tap on a bar now opens its menu on release, so a swipe that starts on a
  bar does not open it. Guide updated in en and uk. *Why:* on an iPad without a keyboard there was no
  way to seek; the owner picked the swipe (option C) from a mockup of four touch options.
- **Falling notes: ← / → move 3 s back / forward inside the fragment** (#46). Plain arrows now seek
  3 seconds of lesson time (playing keeps playing, paused or at rest only moves the position; past
  the end it starts over when looping; in Wait for me it jumps to the step about 3 s away). Fragment
  switching moved to Shift + ← / →, and "switch and play" to ⌥ (Alt) + ← / →. Guide updated in en and
  uk. *Why:* the owner wants to move quickly inside the fragment he is practising, the way the lane
  already shows 3 s ahead; switching fragments is the rarer move.
- **Falling notes: ‹ Previous / Next › as two-part buttons** (#44). The big half switches the fragment
  (it waits at the start, silent); the small ‹▶ / ›▶ half at the outer edge switches and starts playing
  at once. Keys: ← / → switch, Shift + ← / → switch and play. Guide updated in en and uk. *Why:* the
  owner often wants to hear the next fragment straight away and sometimes only to move on; picked N2 of
  the bottom-bar mockup.
- **CI: e2e pinned to ubuntu-24.04** (#44). *Why:* `ubuntu-latest` became 26.04, where Playwright's
  WebKit crashes on page load and every iPad test failed; see `docs/knowledge-base/ci-webkit-ubuntu-26.md`.
- **Dev API: `press()` / `release()` wait for React to commit** (#44). `settle()` now waits two frames
  plus one task (fallback 400 ms instead of 120 ms). *Why:* the falling view sets its key highlights
  inside its frame loop; on a slow CI machine the 120 ms fallback returned before React committed them,
  so "pressed keys are lit" flaked (seen 2026-10-24 and twice on 2026-11-08).

## 2026-11-01

- **Falling notes: a steady bottom bar** (#34). The big button is now always **Play / Pause** (Space) —
  after a pause it goes on from the same place, at the end it plays the fragment again; it no longer
  turns into "Next fragment" or "Again". **‹ Previous** and **Next ›** sit at the left and right edges
  (← / → too, no wrap-around), and a **⏮** glued to the big button goes back to the start of the
  fragment (Shift + Space). The ⏮ From the start button left the top row. Wait for me keeps Next on the
  big button. Guide updated in en and uk. *Why:* the owner learns by listening to one fragment over and
  over and wants the same button in the same place to always do the same thing; picked variant B2 of a
  clickable mockup.

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
