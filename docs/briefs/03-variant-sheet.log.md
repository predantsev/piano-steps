# 03 · Variant C — Sheet + keys · decision log

Appended as the work goes. Each entry: the decision, the evidence it rests on, dead ends, and
`ASSUMPTION:` lines where the brief was silent.

## 2026-10-23

### Setup
- `npm install` in the worktree → exit 0 (88 top-level packages). Branch `feat/3-variant-sheet`,
  clean tree at `8a070bf`.

### D1 · Notation library: VexFlow 5.0.0 (`vexflow/bravura` entry)
- `npm view vexflow versions` → latest stable `5.0.0` (published 2025-03-05); 4.2.5 is the last 4.x.
- Chosen over OpenSheetMusicDisplay because the variant needs per-note control that OSMD hides
  behind MusicXML: colouring note heads by hand, mapping each drawn note head back to the lesson
  note it came from (for tap → play and key → staff), and a cursor driven by the app's own player
  clock. VexFlow takes notes we build directly from the quantised model, so the note ↔ lesson-note
  mapping is ours and exact; OSMD would need a MusicXML round-trip and then a reverse mapping from
  its graphical model.
- Chosen over a hand-written SVG staff: beams, ties, accidentals, rests and spacing are real
  engraving work; the brief asks for *correct* notation.
- 5.x over 4.x: current major; glyphs are drawn as SVG `<text>` in the Bravura font, so CSS `fill`
  on note heads works for hand colours and themes.
- Evidence about VexFlow 5 internals (read from `node_modules/vexflow/build/esm/src`):
  - `entry/vexflow-bravura.js` starts `Font.load('Bravura', …)` (FontFace) and does not expose
    the promise; `element.js` measures glyphs with a canvas `measureText` → the first render must
    wait for the font (`document.fonts.load(…Bravura)`), otherwise widths are wrong.
  - `svgcontext.js` writes ink as presentation attributes (`fill`, `stroke` via `setAttributeNS`),
    default `black`; `stave.js` ledger lines use `#444`. Presentation attributes lose to any CSS
    rule, so theming = CSS on the SVG (`color: var(--strong)` + `currentColor`).
  - `stavenote.js` draws each note as `<g class="vf-stavenote" id="vf-<id>">` with one
    `<g class="vf-notehead">` per key, keys sorted by staff line (`sortedKeyProps.sort`) → I pass
    keys already sorted low → high so head index = key index.
- Bundle: `build/cjs/vexflow-bravura.js` is 728 KB minified; it is only in the lazily loaded
  `sheet` chunk (`variants/index.ts` uses `lazy(() => import('./sheet/index.tsx'))`).
- Dependency added with `npm install vexflow@5.0.0 -w @piano-steps/web` → touches
  `apps/web/package.json` (in scope) and the root `package-lock.json` (shared; listed in report).
