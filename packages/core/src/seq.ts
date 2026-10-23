import type { Hand, LessonNote } from './lesson.ts';
import { parsePitch } from './notes.ts';

/**
 * Compact text notation for writing a voice by hand (used for demo lessons, and handy for
 * an agent that transcribes a video by eye):
 *
 *   "E4/1 E4/1 F4 G4 | C4+E4+G4/2 r/0.5 D#5/0.25"
 *
 * - token = pitch[+pitch…][/beats]; beats in quarter notes, default 1
 * - `r/beats` is a rest; `|` (bar line) is ignored, it is only for the reader
 * - pitches: C4, F#3, Bb2 or До4, Соль#3
 */
export function parseVoice(
  text: string,
  opts: { bpm: number; hand?: Hand; startBeat?: number; velocity?: number },
): LessonNote[] {
  const secPerBeat = 60 / opts.bpm;
  let beat = opts.startBeat ?? 0;
  const out: LessonNote[] = [];
  for (const raw of text.split(/\s+/)) {
    const tok = raw.trim();
    if (!tok || tok === '|') continue;
    const [what, beatsStr] = tok.split('/');
    const beats = beatsStr === undefined ? 1 : Number(beatsStr);
    if (!Number.isFinite(beats) || beats <= 0) throw new Error(`Bad duration in token "${tok}"`);
    if (what.toLowerCase() !== 'r') {
      for (const p of what.split('+')) {
        out.push({
          pitch: parsePitch(p),
          start: round(beat * secPerBeat),
          duration: round(beats * secPerBeat * 0.95),
          ...(opts.hand ? { hand: opts.hand } : {}),
          ...(opts.velocity !== undefined ? { velocity: opts.velocity } : {}),
        });
      }
    }
    beat += beats;
  }
  return out;
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}
