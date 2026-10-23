# Practice UI variants

Instead of debating up front how the practice screen should look, three UIs are built in
parallel on separate branches and compared side by side in the app (tabs in the top bar, or
`?ui=<id>`). The shell (lesson loading, sound, settings, feedback, "hear the original") is shared;
only the practice area differs. Contract: `VariantProps` in `apps/web/src/variant.ts`.

| id | Name | Idea | Brief |
|---|---|---|---|
| `falling` | Falling notes | Synthesia-style: notes fall onto the keys; wait-mode, loop, slow-down | `briefs/01-variant-falling.md` |
| `cards` | Cards | Step by step: big cards "press E5 → then D#5", chords as one card; fragment loop, Next | `briefs/02-variant-cards.md` |
| `sheet` | Sheet + keys | Real notation scrolling in sync with keyboard highlights — learns to read notes on the side | `briefs/03-variant-sheet.md` |

Also in parallel (not a UI variant): `briefs/04-transcriber.md` (YouTube/audio → lesson, separate
module) and `briefs/05-api-and-test-harness.md` (OpenAPI polish, dev automation API, iPad e2e).

When one wins, the others can stay as alternative views or be removed — decided after a real
practice session, not before.
