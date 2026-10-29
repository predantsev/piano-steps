# "One held note drawn as several presses" — the gap between notes does NOT tell you

**Seen:** 2026-10-29, lesson "Люди як кораблі" (Скрябін; audio transcription, bytedance engine).
The owner, playing along on a real iPad, heard places where one held note seems drawn as the same key
pressed two or more times, which sounds odd against the original.

**First guess (wrong):** "consecutive same-pitch notes with a gap under 30–50 ms are a held note split
into re-strikes." In that lesson 649 of 1025 same-pitch, same-hand pairs have a gap under 50 ms;
merging them would drop 1070 notes to 421 (−61 %).

**What the check of the audio showed** (lessons workshop session, CQT per semitone at each 2nd onset):

- Those 649 pairs are mostly **ordinary repeated notes under the pedal**: onset-to-onset median
  0.67 s, 632 of them ≥ 0.3 s apart. The gap is ~0 because the transcriber lengthens a pedalled note
  until the next strike of the same key.
- At the 2nd onset the energy at that pitch rises (median +9 dB; 80 % > 3 dB) — a real new strike.
  Only ~12 % (~78 pairs) show **no new attack** (< 1 dB): those are the plausible split held notes.
- Example: the intro D4 D4 D4 (0.39 s apart, +6.7 / +9.3 dB) is three real strikes.

**What to do with a new transcription:**

- Do **not** merge by gap. The signal worth checking is **no energy rise at that pitch at the 2nd
  onset** (a new attack is missing) — candidates only, the owner's ear decides.
- Any fix goes into a **copy** of the lesson first; the original is replaced only after the owner
  compares them by ear.
- Possibly also an app-side cause: same-key notes that touch (gap 0) may look and sound like one held
  note struck twice; a visible gap before a re-strike might be part of the fix (unverified).
- Tracked in predantsev/piano-steps#37.
