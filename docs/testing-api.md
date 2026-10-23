# Testing the web app as an agent — `window.pianoSteps` and WebMCP

The app has two APIs. [api-for-agents.md](./api-for-agents.md) is the HTTP API that puts lessons in and
fixes them. **This page is the other one**: a small API *inside the running web app* that lets an agent
(Claude, a Playwright test) drive the practice screen — open a lesson, switch the view, press keys, play —
and **read what the screen shows** as JSON, instead of taking screenshots and guessing coordinates.

It exists **only in dev builds** (`npm run dev`, the Vite dev server). A production build
(`npm run build`, Docker, `npm start`) does not contain it — `npm run check:bundle` proves that, and CI runs it.

## Where it lives

| What | Where |
|---|---|
| The API (`window.pianoSteps`) | `apps/web/src/devtools/api.ts`, types in `devtools/types.ts` |
| The same operations as WebMCP tools | `apps/web/src/devtools/webmcp.ts` |
| How it is loaded | `App.tsx`: `if (import.meta.env.DEV) import('./devtools/index.ts')` |
| A variant publishing its own state | `VariantProps.reportState` in `apps/web/src/variant.ts` |
| E2E tests that use it | `e2e/*.spec.ts`, config `playwright.config.ts` |

## Use it from a browser tool (`javascript_tool`)

Open the dev app (`npm run dev` → `http://127.0.0.1:9300`; a worktree uses its own `WEB_PORT`), then
evaluate JavaScript in the page. Every method returns the new state (or a Promise of it):

```js
const ps = window.pianoSteps;
ps.help();                                   // method → one-line description
await ps.selectLesson('ode-to-joy');         // resolves once the lesson is on screen
await ps.setVariant('cards');                // same as tapping the "Cards" tab
const s = await ps.press(['C4', 'E4', 67]);  // hold a chord (MIDI numbers or names)
s.heldKeys;  // [60, 64, 67]
s.litKeys;   // [{pitch:60,name:'C4',mark:'hint'}, …] — what the on-screen keyboard highlights
await ps.release();                          // let go of everything
await ps.press('A3', 150);                   // tap-and-release; returns the state while it was held
await ps.play();                             // current fragment (or play(from, to) in seconds)
ps.getState().player;                        // { state:'playing', time:1.23, from, to, audioContext, … }
await ps.stop();
```

### What `getState()` returns

| Field | Meaning |
|---|---|
| `ready` | a lesson is loaded and the practice view has rendered (no loading placeholder) |
| `lesson` | `{ id, slug, title, noteCount, durationSec, fragmentCount }` or `null` |
| `variant`, `variants` | the practice view on screen (`?ui=`) and the available ones |
| `fragment` | `{ position, title, start, end }` the view says the user is on, or `null` (whole lesson) |
| `player` | `state`, `time` (s), `rate`, `from`, `to`, `loop`, `audioUnlocked`, `audioContext`, `samplesLoaded` |
| `heldKeys` | MIDI numbers held down right now (finger, computer keyboard or this API) |
| `litKeys` | keys the on-screen keyboard highlights, with their mark: `R`/`L` (hand), `next`, `ok`, `bad`, `hint` |
| `recentInput` | the last 30 key events `{type:'on'|'off', pitch, name, source, msAgo}` — a tap is over before you can look, it shows up here (`source: 'screen'`) |
| `variantState` | whatever the current view published through `reportState` (see below), else `null` |
| `dialog`, `error`, `offline`, `settings` | the shell's state |
| `webmcp` | `{ available, tools }` — whether this browser has WebMCP and which tools are registered |
| `display.framesRunning` | `false` = no animation frame for 250 ms: the tab is in the background or the browser pane is hidden. Views that redraw on `requestAnimationFrame` are then frozen and `litKeys` is stale — bring the tab to the front |

`litKeys` is read from the DOM of `ui/PianoKeyboard` (`.pk [data-pitch]` with a `pk-<mark>` class), so it
is what the screen really shows. A view that draws its own keyboard without that component shows up only
through `variantState`.

### Sound and the clock

Browsers start audio only after a real user gesture (the iOS rule). The shell creates the piano sound on
the first `pointerdown` / `keydown`. The API **never** fakes that gesture (calling the unlock without one
would leave the app silent for the session). So:

- `play()` adds a `warning` when the AudioContext is not `running` — the player clock does not move.
  Click/tap the page once (a browser tool's click, or `page.click()` in Playwright) and play again.
- If the AudioContext is running but nothing was tapped yet, `play()` warns that it is playing silently;
  the clock and the highlighted keys still work, which is all a test needs.

`press()` sends key events with source `sim` (the input layer reserves it for this) and sounds the note
when audio is unlocked.

## Use it as WebMCP tools

When the browser has WebMCP (`document.modelContext`), the same operations are registered as tools:
`get_state`, `list_lessons`, `select_lesson {slug}`, `set_variant {id}`, `press_keys {pitches, holdMs?}`,
`release_keys {pitches?}`, `play {from?, to?}`, `stop`. Each has a description and a JSON Schema, so an
agent can discover them with `getTools()` without reading this file. A failing call answers
`{ "error": "…" }` instead of throwing.

```js
const mc = document.modelContext;            // on document, not navigator
const tools = await mc.getTools();
const press = tools.find((t) => t.name === 'press_keys');
const raw = await mc.executeTool(press, { pitches: ['D4', 'F#4'] }); // Chromium 156: args as an OBJECT
JSON.parse(JSON.parse(raw).content[0].text); // → the state, as from window.pianoSteps.press()
// or, the same through the helper (handles both API shapes):
await window.pianoSteps.callTool('press_keys', { pitches: ['D4', 'F#4'] });
```

Where WebMCP exists (measured 2026-10-23):

| Browser | `document.modelContext` |
|---|---|
| Playwright Chromium 156 with `--enable-features=WebMCPTesting` (the e2e desktop project) | yes |
| Playwright Chromium without the flag, Playwright WebKit (the iPad project) | no |
| The Claude desktop app's built-in browser (Chrome 152, Electron) | no — use `window.pianoSteps` |

API shape differences: on Chrome 152 `executeTool` wanted the args as a JSON **string**
(`Lab/webmcp-demo/README.md`); on Chromium 156 it wants an **object** and rejects a string with
`TypeError: … invalid input object`. `callTool()` tries the object form and falls back to the string.
There is no `unregisterTool`; registering a name twice throws `InvalidStateError: Duplicate tool name`
(the app registers once per page and tolerates that after a hot reload).

## Let a practice view publish its state (`reportState`)

A variant can make its own state visible to tests without anyone reading its pixels:

```ts
export default function Cards({ lesson, reportState }: VariantProps) {
  // …
  useEffect(() => {
    reportState?.({ step, stepCount: steps.length, expected: steps[step]?.pitches, mode });
  }, [step, mode]);
}
```

Plain JSON only. The shell keeps the last object for the mounted view and drops it when the view or the
lesson changes; it appears as `getState().variantState`. Calling it is cheap (no re-render). It is optional
— a view that never calls it still works everywhere.

## E2E tests (Playwright)

```bash
npm run e2e:install   # once: Chromium + WebKit for Playwright
npm run e2e           # starts its own API (in-memory DB, 3 demo lessons) + Vite dev server
npx playwright test --project=ipad-webkit e2e/app.spec.ts   # one project / one file
```

- **Projects:** `ipad-webkit` (iPad Pro 11 landscape profile, viewport 1180×820, touch, WebKit) and
  `desktop-chromium` (1440×900, WebMCP flag on).
- **Servers:** API on `E2E_API_PORT` (default 9391) with `PGLITE_DIR=memory://`, web on `E2E_WEB_PORT`
  (default 9390) — outside the `93x0/93x1` pairs of the worktrees. Both projects share one database, so
  tests use unique slugs/messages and assert on their own records, never on counts.
- **Every test fails on a console error or an uncaught page error** (`e2e/fixtures.ts`; the ignore list is
  empty). The piano samples from `tonejs.github.io` are answered with 50 ms of silence, so the suite needs
  no internet.
- **Selectors use shell-owned DOM only** (top bar, `[role=tab]`, `.pk [data-pitch]`, the file input,
  dialogs) plus `window.pianoSteps` — the views themselves are free to change.
- Playwright has no touch-and-hold: on the iPad project a tap is a real touch (`pointerType: 'touch'`),
  holding a key uses the mouse.
- WebKit has no WebMCP, so the WebMCP test is **skipped** on `ipad-webkit` by design.

What the suite covers: the app loads with the demo lessons; switching lessons (top bar and API);
every view tab renders without console errors and without sideways scrolling; a tap on an on-screen key
registers, a held key is lit; the "sounds wrong" dialog posts and the item is in `GET /api/feedback`;
importing a lesson JSON and a MusicXML file through the file input; the API-token field appears when
`/api/health` says `auth: true` and the token is sent as `Authorization: Bearer …`; `window.pianoSteps`
end to end; the WebMCP tools through the real `document.modelContext`.
