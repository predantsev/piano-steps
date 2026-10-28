# The in-app guide

The **?** button in the top bar opens "How to use it". The guide is part of the UI, so it lives
**in the repo, next to the code it describes** — one file per UI language:

- [`packages/core/src/guide/guide.en.json`](../packages/core/src/guide/guide.en.json)
- [`packages/core/src/guide/guide.uk.json`](../packages/core/src/guide/guide.uk.json)

They are bundled into the app (the guide works offline) and served by `GET /api/guide?lang=<code>`
(unknown languages fall back to English). A test checks that every language has the same sections
in the same order.

## Changing it

**In a PR, every language at once** — the same PR that changes the app (AGENTS.md § "Change log and
the guide"). Keep section `id`s identical across languages.

**Quick fix through the API (temporary):** `PUT /api/guide/<code>` saves an *override* in the
database (`guide_overrides`); the app shows it at once, without a rebuild. It is not the source of
truth. Whoever saves one must move the text into `guide.<code>.json` in a PR and then
`DELETE /api/guide/<code>`. `GET /api/guides` lists every language with `source: "repo"` or
`"override"`; the server also warns about unsynced overrides on start, and the session-start check
in CLAUDE.md looks for them.

```bash
curl -s http://127.0.0.1:9300/api/guides
curl -X PUT http://127.0.0.1:9300/api/guide/uk -H 'content-type: application/json' --data @guide.uk.json
curl -X DELETE http://127.0.0.1:9300/api/guide/uk
```

## If you install the app

The guides in the repo describe the app as shipped. **If you change the app, keeping the guide in
step is your responsibility** — in every language.

## Format

```json
{
  "title": "How to use it",
  "sections": [
    { "id": "flow", "title": "How it works — in short", "body": ["A paragraph.", "• A list item."] }
  ]
}
```

- `id` — stable, lowercase, the same in every language (tests and links use it).
- `body` — paragraphs; one starting with `• ` is drawn as a list item.
- Schema: `GuideInput` in `packages/core/src/guide/guide.ts`; live spec at `/api/docs` (tag *guide*).
