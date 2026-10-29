# Held notes come out of the transcriber as several short re-strikes

**Seen:** 2026-10-29, lesson "Люди як кораблі" (Скрябін; audio transcription, bytedance engine).
The owner, playing along on a real iPad, heard places where one held note is drawn as the same key
pressed two or more times, which sounds odd against the original.

**Evidence:** of 1070 notes, 1035 pairs were consecutive notes of the same pitch; **681 had a gap of
under 30 ms** between the end of one and the start of the next, then almost nothing until ≥150 ms
(4 pairs at 80–150 ms, 1 at 30–80 ms). A pianist does not re-strike that fast, so these are very
likely one held note split into re-onsets (inferred — not every pair was checked by ear).

**What to do with a new transcription:**

- Count consecutive same-pitch pairs with a gap under ~30–50 ms (sanity check in
  `.claude/skills/transcribe/SKILL.md` § 2). Many of them → the held notes were split.
- Don't fix the lesson in place: make a **copy** with each such run merged into one note
  (start of the first, end of the last) and let the owner compare by ear before replacing the
  original. Real repeated notes exist — the owner's ear decides.
- Planned app side: a clean-up step in `tools/transcribe` and an in-app "merge with the next note"
  (predantsev/piano-steps#37).
