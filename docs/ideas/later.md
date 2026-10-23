# Parked for later

- **Hosting** — not now; the app runs locally (Docker). Keep it deployable: one image, config by
  env (`DATABASE_URL`, `API_TOKEN`), no local-only assumptions in code. See `Startups/hosting-research`.
- **Microphone check** — detect what the user plays on the acoustic piano (Web Audio pitch
  detection). Single-note melodies are realistic; chords are hard. Needs a secure context
  (localhost or HTTPS) — on an iPad over plain LAN http the mic is blocked.
- **Multi-user** — single user + API token today. "Everyone can use it" needs accounts and
  private-by-default lessons (user-uploaded transcriptions must not become public).
- **Transcription as its own service** — `tools/transcribe` already talks to the app only via the
  API; it can move to its own repo/container unchanged.
- **iOS silent switch** — Web Audio is muted when the ring/silent switch is on; document or work
  around (an `<audio>` element unlock trick) if it bites.
