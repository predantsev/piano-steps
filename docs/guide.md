# The in-app guide

The **?** button in the top bar opens "How to use it". Its text is **data, not code**: one record
per language in the database table `guides` (`lang` = two-letter code, `title`, `sections` as
JSON), served by `GET /api/guide?lang=<code>` (falls back to English) and replaced with
`PUT /api/guide/<code>`. `GET /api/guides` lists the languages present.

## If you install the app

The repo ships **one example guide, in English**:
[`packages/core/src/guide/guide.en.json`](../packages/core/src/guide/guide.en.json).
On the first start with an empty `guides` table the server copies it into the database
(row `lang = 'en'`). Use it as your guide, or replace it:

```bash
curl -X PUT http://127.0.0.1:9300/api/guide/en \
  -H 'content-type: application/json' --data @my-guide.en.json
```

Other languages are added the same way (`PUT /api/guide/uk`, …) and live **only in your
database** — they are not in the repo. Without a server (offline mode) the app shows the bundled
English example.

**If you change the app, keeping the guide in step is your responsibility** — in every language
your database has. The example file in the repo describes the app as shipped, nothing more.

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
