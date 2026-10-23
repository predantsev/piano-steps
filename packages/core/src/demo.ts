import type { LessonInput } from './lesson.ts';
import { parseVoice } from './seq.ts';

/**
 * Demo lessons — public-domain compositions only (this repo is public).
 * User lessons never live in git: they go to the database through the API.
 */

const beats = (b: number, bpm: number) => Math.round(b * (60 / bpm) * 10000) / 10000;

function odeToJoy(): LessonInput {
  const bpm = 100;
  const R = `E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/1.5 D4/0.5 D4/2 |
             E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/1.5 C4/0.5 C4/2`;
  const L = `C3/4 | G2/4 | C3/4 | G2/4 | C3/4 | G2/4 | C3/2 G2/2 | G2/2 C3/2`;
  return {
    slug: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    description: 'Symphony No. 9 theme, simplified in C major. Right hand melody, left hand bass notes.',
    license: 'public-domain',
    source: { kind: 'manual', note: 'Arranged by hand for the demo' },
    tempo: { bpm, timeSignature: [4, 4] },
    notes: [...parseVoice(R, { bpm, hand: 'R' }), ...parseVoice(L, { bpm, hand: 'L', velocity: 0.55 })],
  };
}

function furElise(): LessonInput {
  const bpm = 72; // quarter = 72 (≈ dotted quarter 48), 3/8
  const R = `E5/0.25 D#5/0.25 |
             E5/0.25 D#5/0.25 E5/0.25 B4/0.25 D5/0.25 C5/0.25 |
             A4/0.5 r/0.25 C4/0.25 E4/0.25 A4/0.25 |
             B4/0.5 r/0.25 E4/0.25 G#4/0.25 B4/0.25 |
             C5/0.5 r/0.25 E4/0.25 E5/0.25 D#5/0.25 |
             E5/0.25 D#5/0.25 E5/0.25 B4/0.25 D5/0.25 C5/0.25 |
             A4/0.5 r/0.25 C4/0.25 E4/0.25 A4/0.25 |
             B4/0.5 r/0.25 E4/0.25 C5/0.25 B4/0.25 |
             A4/1.5`;
  const L = `r/2 |
             A2/0.25 E3/0.25 A3/0.25 r/0.75 |
             E2/0.25 E3/0.25 G#3/0.25 r/0.75 |
             A2/0.25 E3/0.25 A3/0.25 r/0.75 |
             r/1.5 |
             A2/0.25 E3/0.25 A3/0.25 r/0.75 |
             E2/0.25 E3/0.25 G#3/0.25 r/0.75 |
             A2/0.25 E3/0.25 A3/1`;
  return {
    slug: 'fur-elise-opening',
    title: 'Für Elise — opening',
    composer: 'Ludwig van Beethoven',
    description: 'Bagatelle No. 25 in A minor, the famous first phrase (bars 1–8 with the pickup).',
    license: 'public-domain',
    source: { kind: 'manual', note: 'Entered by hand for the demo' },
    tempo: { bpm, timeSignature: [3, 8] },
    notes: [...parseVoice(R, { bpm, hand: 'R' }), ...parseVoice(L, { bpm, hand: 'L', velocity: 0.55 })],
    // explicit fragments: the pickup shifts bar lines, so bar-based auto-splitting would cut mid-phrase
    fragments: [
      { title: 'Motif', start: 0, end: beats(2, bpm) },
      { title: 'Bars 2–3', start: beats(2, bpm), end: beats(5, bpm) },
      { title: 'Bars 4–5', start: beats(5, bpm), end: beats(8, bpm) },
      { title: 'Bars 6–8', start: beats(8, bpm), end: beats(12.5, bpm) },
    ],
  };
}

function twinkle(): LessonInput {
  const bpm = 90;
  const R = `C4 C4 G4 G4 | A4 A4 G4/2 | F4 F4 E4 E4 | D4 D4 C4/2 |
             G4 G4 F4 F4 | E4 E4 D4/2 | G4 G4 F4 F4 | E4 E4 D4/2 |
             C4 C4 G4 G4 | A4 A4 G4/2 | F4 F4 E4 E4 | D4 D4 C4/2`;
  const L = `C3/4 | F3/2 C3/2 | F3/2 C3/2 | G2/2 C3/2 |
             C3/2 F3/2 | C3/2 G2/2 | C3/2 F3/2 | C3/2 G2/2 |
             C3/4 | F3/2 C3/2 | F3/2 C3/2 | G2/2 C3/2`;
  return {
    slug: 'twinkle-twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional',
    description: 'The simplest possible start: one note at a time in the right hand, slow bass in the left.',
    license: 'public-domain',
    source: { kind: 'manual', note: 'Entered by hand for the demo' },
    tempo: { bpm, timeSignature: [4, 4] },
    notes: [...parseVoice(R, { bpm, hand: 'R' }), ...parseVoice(L, { bpm, hand: 'L', velocity: 0.55 })],
  };
}

export function demoLessons(): LessonInput[] {
  return [twinkle(), odeToJoy(), furElise()];
}
