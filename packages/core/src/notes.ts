/** Pitch ↔ name helpers. Pitch = MIDI note number; 60 = C4 (middle C). */

export type NoteNameSystem = 'letter' | 'solfege';

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE_UK = ['До', 'До#', 'Ре', 'Ре#', 'Мі', 'Фа', 'Фа#', 'Соль', 'Соль#', 'Ля', 'Ля#', 'Сі'];
const BLACK = new Set([1, 3, 6, 8, 10]);

export const MIN_PIANO_PITCH = 21; // A0
export const MAX_PIANO_PITCH = 108; // C8

export function pitchClass(pitch: number): number {
  return ((pitch % 12) + 12) % 12;
}

export function octaveOf(pitch: number): number {
  return Math.floor(pitch / 12) - 1;
}

export function isBlackKey(pitch: number): boolean {
  return BLACK.has(pitchClass(pitch));
}

/** "C4", "F#3" — or "До4", "Фа#3" for solfège. `withOctave: false` → "C", "До". */
export function pitchName(
  pitch: number,
  system: NoteNameSystem = 'letter',
  opts: { withOctave?: boolean } = {},
): string {
  const names = system === 'solfege' ? SOLFEGE_UK : LETTERS;
  const base = names[pitchClass(pitch)];
  return opts.withOctave === false ? base : `${base}${octaveOf(pitch)}`;
}

/** Parse "C4", "c#4", "Db3", "A0", "До4", "Соль#3" → MIDI pitch. Throws on garbage. */
export function parsePitch(name: string): number {
  const s = name.trim();
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(s);
  if (m) {
    const letter = m[1].toUpperCase();
    let pc = LETTERS.indexOf(letter);
    if (m[2] === '#' || m[2] === '♯') pc += 1;
    if (m[2] === 'b' || m[2] === '♭') pc -= 1;
    return (Number(m[3]) + 1) * 12 + pc;
  }
  const sm = /^(До|Ре|Мі|Фа|Соль|Ля|Сі)(#?)(-?\d)$/i.exec(s);
  if (sm) {
    const idx = SOLFEGE_UK.findIndex((n) => n.toLowerCase() === sm[1].toLowerCase());
    return (Number(sm[3]) + 1) * 12 + idx + (sm[2] ? 1 : 0);
  }
  throw new Error(`Cannot parse pitch "${name}"`);
}

/**
 * Keyboard range that covers the given pitches, widened to whole octaves (C…B)
 * and to at least `minKeys` keys, clamped to the 88-key piano.
 */
export function keyboardRange(pitches: Iterable<number>, minKeys = 25): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pitches) {
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  if (!Number.isFinite(lo)) {
    lo = 48;
    hi = 72;
  }
  lo = lo - pitchClass(lo); // down to a C
  hi = hi + (11 - pitchClass(hi)); // up to a B
  while (hi - lo + 1 < minKeys) {
    if (lo - 12 >= MIN_PIANO_PITCH - 9) lo -= 12;
    if (hi - lo + 1 < minKeys) hi += 12;
  }
  return [Math.max(MIN_PIANO_PITCH, lo), Math.min(MAX_PIANO_PITCH, hi)];
}
