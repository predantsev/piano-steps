import type { Fragment, Hand, LessonNote, Tempo } from '@piano-steps/core';

/**
 * Lesson notes (seconds, MIDI-shaped) → a quantised grand-staff score (bars, beats, ties).
 *
 * Pure and DOM-free (unit-tested in Node); the VexFlow renderer only draws what this builds.
 *
 * - Grid: sixteenth notes (TPQ = 4 ticks per quarter). Triplets and 32nds snap to the nearest 16th.
 * - Tempo: `lesson.tempo` when present; otherwise estimated from the onsets (marked `tempoEstimated`).
 * - Bar lines: the time signature (4/4 when missing) plus a detected pickup (anacrusis) — e.g.
 *   Für Elise's two-sixteenth upbeat in 3/8.
 * - Staves: right hand → treble, left hand → bass. A note without a hand goes by pitch (< C4 → bass).
 * - One voice per staff: notes starting together form a chord; a note is cut where the next onset
 *   on its staff begins (legato), and a gap becomes a rest only when it is a real rest rather than
 *   the release gap of normal playing (≤ 30 % of the time to the next onset, at most a quarter).
 * - Notes that cross a bar line, or that no single note value can express, are split and tied.
 */

export const TPQ = 4; // ticks per quarter note → 1 tick = a sixteenth

export type Staff = 'treble' | 'bass';
export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface Spelling {
  letter: Letter;
  /** -1 flat, 0 natural, +1 sharp */
  alter: -1 | 0 | 1;
  octave: number;
}

export interface ScoreNote extends Spelling {
  pitch: number;
  hand: Hand;
  /** Index into the lesson's `notes` array — the link back to what the player plays. */
  index: number;
  /** VexFlow key, e.g. "d#/5". */
  key: string;
}

export interface ScoreEvent {
  /** Unique within the score. */
  id: string;
  staff: Staff;
  /** Absolute position in ticks from the score origin. */
  start: number;
  /** Ticks; always one notatable value (see NOTE_VALUES). */
  dur: number;
  /** VexFlow duration code: w h q 8 16. */
  code: string;
  dots: number;
  /** Empty = rest. Sorted low → high. */
  notes: ScoreNote[];
  /** This chord is tied into the next event of the same staff. */
  tieToNext: boolean;
  /** This event is the tied continuation of the previous one (not a new attack). */
  continued: boolean;
}

export interface Measure {
  /** Position in `Score.measures`. */
  index: number;
  /** Bar number as a musician counts it: 0 = pickup, then 1, 2, … */
  number: number;
  start: number;
  length: number;
  treble: ScoreEvent[];
  bass: ScoreEvent[];
}

export interface Score {
  bpm: number;
  timeSignature: [number, number];
  tempoEstimated: boolean;
  /** Lesson time (s) of tick 0. */
  originSec: number;
  secPerTick: number;
  barTicks: number;
  /** Length of the pickup bar in ticks; 0 = the piece starts on a downbeat. */
  pickupTicks: number;
  /** Key signature as a count of sharps (+) or flats (−), −5…+5. */
  keyFifths: number;
  measures: Measure[];
  /** Mean distance of the original onsets from the grid, in ticks (0 = already on the grid). */
  snapError: number;
}

/** Notatable lengths in ticks → [VexFlow code, dots]. Greedy splitting uses this order. */
export const NOTE_VALUES: ReadonlyArray<[number, string, number]> = [
  [16, 'w', 0],
  [12, 'h', 1],
  [8, 'h', 0],
  [6, 'q', 1],
  [4, 'q', 0],
  [3, '8', 1],
  [2, '8', 0],
  [1, '16', 0],
];

const EPS = 1e-6;

export function staffOf(note: Pick<LessonNote, 'pitch' | 'hand'>): Staff {
  const hand = note.hand ?? (note.pitch < 60 ? 'L' : 'R');
  return hand === 'L' ? 'bass' : 'treble';
}

export function secToTick(score: Pick<Score, 'originSec' | 'secPerTick'>, sec: number): number {
  return (sec - score.originSec) / score.secPerTick;
}

export function tickToSec(score: Pick<Score, 'originSec' | 'secPerTick'>, tick: number): number {
  return score.originSec + tick * score.secPerTick;
}

/** Split a length in ticks into notatable values, longest first (5 → 4 + 1). */
export function splitTicks(len: number): number[] {
  const out: number[] = [];
  let rest = Math.round(len);
  while (rest > 0) {
    const v = NOTE_VALUES.find(([t]) => t <= rest)![0];
    out.push(v);
    rest -= v;
  }
  return out;
}

// ── tempo ────────────────────────────────────────────────────────────────────

/**
 * Estimate a quarter-note tempo from note onsets (for lessons without `tempo`, e.g. a raw
 * transcription). The most common gap between consecutive onsets is taken as an eighth or a
 * quarter, folded into 60…140 bpm, then fine-tuned to the grid with the smallest snap error.
 */
export function estimateTempo(notes: readonly LessonNote[]): { bpm: number; originSec: number } {
  const onsets = uniqueOnsets(notes);
  const originSec = onsets[0] ?? 0;
  const gaps: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const g = onsets[i] - onsets[i - 1];
    if (g >= 0.08 && g <= 2.5) gaps.push(g);
  }
  if (gaps.length < 2) return { bpm: 100, originSec };

  // most common gap: histogram on a log scale (bins ±4 %)
  let best = gaps[0];
  let bestCount = 0;
  for (const g of gaps) {
    const c = gaps.filter((x) => Math.abs(Math.log(x / g)) < 0.04).length;
    if (c > bestCount || (c === bestCount && g < best)) {
      best = g;
      bestCount = c;
    }
  }
  let bpm = 60 / best; // the commonest gap as a quarter
  while (bpm < 60) bpm *= 2;
  while (bpm >= 140) bpm /= 2;

  // fine-tune ±8 % for the smallest mean snap error to the 16th grid
  let tuned = bpm;
  let tunedErr = Infinity;
  for (let f = 0.92; f <= 1.08 + EPS; f += 0.005) {
    const b = bpm * f;
    const spt = 60 / b / TPQ;
    let err = 0;
    for (const t of onsets) {
      const x = (t - originSec) / spt;
      err += Math.abs(x - Math.round(x));
    }
    err /= onsets.length;
    if (err < tunedErr - 1e-4) {
      tunedErr = err;
      tuned = b;
    }
  }
  return { bpm: Math.round(tuned * 10) / 10, originSec };
}

function uniqueOnsets(notes: readonly LessonNote[]): number[] {
  const starts = [...notes].map((n) => n.start).sort((a, b) => a - b);
  const out: number[] = [];
  for (const s of starts) if (!out.length || s - out[out.length - 1] > 0.045) out.push(s);
  return out;
}

// ── key signature ────────────────────────────────────────────────────────────

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SHARP_NAMES: Array<[Letter, -1 | 0 | 1]> = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_NAMES: Array<[Letter, -1 | 0 | 1]> = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];
/** VexFlow key-signature names by fifths (−5…+5). */
export const KEY_NAMES: Record<number, string> = {
  [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B',
};

/**
 * Pick the key signature (−5…+5 fifths) whose major scale covers the most note-time.
 * Biased to fewer accidentals: a key with more sharps/flats must cover clearly more (≥ 3 %),
 * so a melody with an occasional accidental keeps the plain C major / A minor signature.
 */
export function estimateKeyFifths(notes: readonly LessonNote[]): number {
  const weight = new Array(12).fill(0);
  for (const n of notes) weight[((n.pitch % 12) + 12) % 12] += Math.max(0.05, Math.min(n.duration, 2));
  const total = weight.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const cover = (fifths: number) => {
    const tonic = (((fifths * 7) % 12) + 12) % 12;
    return MAJOR.reduce((s, d) => s + weight[(tonic + d) % 12], 0) / total;
  };
  // candidates in order of accidentals; a key with more of them must cover ≥ 3 % more note-time
  let best = 0;
  let bestCover = cover(0);
  for (const k of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
    const c = cover(k);
    if (c > bestCover + 0.03) {
      best = k;
      bestCover = c;
    }
  }
  return best;
}

/** Spell a pitch in a key: sharps in sharp keys and C, flats in flat keys. */
export function spell(pitch: number, keyFifths: number): Spelling {
  const pc = ((pitch % 12) + 12) % 12;
  const [letter, alter] = (keyFifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pc];
  return { letter, alter, octave: Math.floor(pitch / 12) - 1 };
}

export function vexKey(s: Spelling): string {
  return `${s.letter.toLowerCase()}${s.alter === 1 ? '#' : s.alter === -1 ? 'b' : ''}/${s.octave}`;
}

// ── pickup (anacrusis) ───────────────────────────────────────────────────────

interface Snapped {
  index: number;
  pitch: number;
  hand: Hand;
  staff: Staff;
  /** Onset on the grid (ticks). */
  s: number;
  /** Raw end (ticks, unrounded). */
  e: number;
}

/**
 * Where does the first full bar start? Candidates are every tick inside one bar. Each candidate is
 * scored by how much "weight" lands on its downbeats — long notes and bass notes mark downbeats —
 * and boosted when fragment boundaries and the last note's end fall on its bar lines. A pickup must
 * beat "no pickup" by 25 %; most music starts on the downbeat.
 */
export function detectPickup(
  snapped: readonly Snapped[],
  barTicks: number,
  boundaryTicks: readonly number[],
  endTick: number,
): number {
  if (barTicks <= 1 || snapped.length === 0) return 0;
  const byTick = new Map<number, { dur: number; bass: boolean; count: number }>();
  for (const n of snapped) {
    const cur = byTick.get(n.s) ?? { dur: 0, bass: false, count: 0 };
    cur.dur = Math.max(cur.dur, Math.min(barTicks, Math.max(1, n.e - n.s)));
    cur.bass ||= n.staff === 'bass';
    cur.count++;
    byTick.set(n.s, cur);
  }
  const mod = (x: number) => ((x % barTicks) + barTicks) % barTicks;
  const interior = boundaryTicks.filter((b) => b > 0.5 && b < endTick - 0.5);
  const score = (o: number) => {
    let s = 0;
    for (const [t, w] of byTick) if (mod(t - o) === 0) s += w.dur + (w.bass ? 2 : 0) + (w.count - 1) * 0.5;
    const aligned = interior.length ? interior.filter((b) => mod(b - o) === 0).length / interior.length : 0;
    const endAligned = mod(endTick - o) === 0 ? 0.15 : 0;
    return s * (1 + 0.5 * aligned + endAligned);
  };
  const base = score(0);
  let best = 0;
  let bestScore = base;
  for (let o = 1; o < barTicks; o++) {
    const sc = score(o);
    if (sc > bestScore) {
      best = o;
      bestScore = sc;
    }
  }
  return best !== 0 && bestScore > base * 1.25 ? best : 0;
}

// ── the score ────────────────────────────────────────────────────────────────

function validTimeSignature(ts: Tempo['timeSignature']): [number, number] {
  if (!ts) return [4, 4];
  const [num, den] = ts;
  if (![1, 2, 4, 8, 16].includes(den) || num < 1 || num > 32) return [4, 4];
  return [num, den];
}

export function buildScore(
  notes: readonly LessonNote[],
  opts: { tempo?: Tempo; fragments?: readonly Fragment[] } = {},
): Score {
  const timeSignature = validTimeSignature(opts.tempo?.timeSignature);
  const est = opts.tempo ? null : estimateTempo(notes);
  const bpm = Math.min(400, Math.max(20, opts.tempo?.bpm ?? est!.bpm));
  const originSec = est?.originSec ?? 0;
  const secPerTick = 60 / bpm / TPQ;
  const barTicks = timeSignature[0] * ((TPQ * 4) / timeSignature[1]);
  const keyFifths = estimateKeyFifths(notes);

  // 1 · snap onsets to the grid
  let errSum = 0;
  const snapped: Snapped[] = notes.map((n, index) => {
    const raw = (n.start - originSec) / secPerTick;
    const s = Math.max(0, Math.round(raw));
    errSum += Math.abs(raw - Math.round(raw));
    return {
      index,
      pitch: n.pitch,
      hand: n.hand ?? (n.pitch < 60 ? 'L' : 'R'),
      staff: staffOf(n),
      s,
      e: Math.max(raw + 0.05, (n.start + n.duration - originSec) / secPerTick),
    };
  });
  const snapError = notes.length ? errSum / notes.length : 0;
  const rawEnd = snapped.reduce((m, n) => Math.max(m, n.e), 0);

  // 2 · bar lines
  const boundaryTicks = (opts.fragments ?? []).map((f) => (f.start - originSec) / secPerTick).filter(
    (b) => Math.abs(b - Math.round(b)) < 0.1,
  ).map(Math.round);
  const pickupTicks = detectPickup(snapped, barTicks, boundaryTicks, Math.round(rawEnd));
  const barLineAtOrAfter = (t: number) => {
    if (pickupTicks > 0 && t <= pickupTicks) return t <= 0 ? 0 : pickupTicks;
    return pickupTicks + Math.ceil((t - pickupTicks - EPS) / barTicks) * barTicks;
  };

  // 3 · per staff: chords (same onset) with legato-aware ends
  type Ev = { start: number; end: number; notes: Snapped[] };
  const byStaff: Record<Staff, Ev[]> = { treble: [], bass: [] };
  for (const staff of ['treble', 'bass'] as const) {
    const groups = new Map<number, Snapped[]>();
    for (const n of snapped) if (n.staff === staff) (groups.get(n.s) ?? groups.set(n.s, []).get(n.s)!).push(n);
    const starts = [...groups.keys()].sort((a, b) => a - b);
    starts.forEach((s, k) => {
      const ns = groups.get(s)!.sort((a, b) => a.pitch - b.pitch);
      const end = Math.max(...ns.map((n) => n.e));
      const next = k + 1 < starts.length ? starts[k + 1] : Math.max(s + 1, barLineAtOrAfter(end - 0.5));
      let q = Math.min(next, Math.max(s + 1, Math.round(end)));
      // a short release gap is articulation, not a rest: ≤ 30 % of the time to the next onset
      // and at most a quarter (so a whole note followed by a quarter rest keeps its rest)
      if (q < next && next - end <= Math.min(0.3 * (next - s), TPQ)) q = next;
      byStaff[staff].push({ start: s, end: q, notes: ns });
    });
  }

  // 4 · measures
  const lastTick = Math.max(1, ...byStaff.treble.map((e) => e.end), ...byStaff.bass.map((e) => e.end));
  const measures: Measure[] = [];
  let m0 = 0;
  let number = pickupTicks > 0 ? 0 : 1;
  while (m0 < lastTick - EPS) {
    const len = pickupTicks > 0 && m0 === 0 ? pickupTicks : barTicks;
    measures.push({ index: measures.length, number: number++, start: m0, length: len, treble: [], bass: [] });
    m0 += len;
  }
  const measureAt = (t: number): Measure => {
    const i = pickupTicks > 0 ? (t < pickupTicks ? 0 : 1 + Math.floor((t - pickupTicks) / barTicks)) : Math.floor(t / barTicks);
    return measures[Math.min(measures.length - 1, Math.max(0, i))];
  };

  const spelled = (n: Snapped): ScoreNote => {
    const sp = spell(n.pitch, keyFifths);
    return { ...sp, pitch: n.pitch, hand: n.hand, index: n.index, key: vexKey(sp) };
  };

  for (const staff of ['treble', 'bass'] as const) {
    const counter = new Map<number, number>();
    const push = (m: Measure, start: number, dur: number, ns: ScoreNote[], tieToNext: boolean, continued: boolean) => {
      const k = counter.get(m.index) ?? 0;
      counter.set(m.index, k + 1);
      const [, code, dots] = NOTE_VALUES.find(([t]) => t === dur)!;
      m[staff].push({ id: `${staff[0]}${m.index}-${k}`, staff, start, dur, code, dots, notes: ns, tieToNext, continued });
    };
    const rests = (from: number, to: number) => {
      let t = from;
      while (t < to - EPS) {
        const m = measureAt(t);
        const segEnd = Math.min(to, m.start + m.length);
        for (const d of splitTicks(segEnd - t)) {
          push(m, t, d, [], false, false);
          t += d;
        }
        t = segEnd;
      }
    };
    let cursor = 0;
    for (const ev of byStaff[staff]) {
      if (ev.start > cursor) rests(cursor, ev.start);
      const ns = ev.notes.map(spelled);
      // split at bar lines, then into notatable values; every piece but the last ties onward
      const pieces: Array<[Measure, number, number]> = [];
      let t = ev.start;
      while (t < ev.end - EPS) {
        const m = measureAt(t);
        const segEnd = Math.min(ev.end, m.start + m.length);
        for (const d of splitTicks(segEnd - t)) {
          pieces.push([m, t, d]);
          t += d;
        }
        t = segEnd;
      }
      pieces.forEach(([m, start, d], i) => push(m, start, d, ns, i < pieces.length - 1, i > 0));
      cursor = ev.end;
    }
    const scoreEnd = measures.length ? measures[measures.length - 1].start + measures[measures.length - 1].length : 0;
    if (cursor < scoreEnd) rests(cursor, scoreEnd);
  }

  return { bpm, timeSignature, tempoEstimated: !opts.tempo, originSec, secPerTick, barTicks, pickupTicks, keyFifths, measures, snapError };
}

/** The whole bars that overlap a time window (a fragment), in order. */
export function measuresInWindow(score: Score, startSec: number, endSec: number): Measure[] {
  const a = secToTick(score, startSec);
  const b = secToTick(score, endSec);
  const hit = score.measures.filter((m) => m.start < b - 0.25 && m.start + m.length > a + 0.25);
  if (hit.length) return hit;
  // a window shorter than a tick (or outside the notes): the bar it starts in, if any
  const m = score.measures.find((x) => a >= x.start - EPS && a < x.start + x.length);
  return m ? [m] : score.measures.slice(-1);
}

/**
 * The bars to draw for a fragment. Membership is decided once, in seconds (core `notesInRange`,
 * the same window the player plays); the drawing follows it: the bars the window overlaps plus the
 * bar of every member's attack. A downbeat played a little early belongs to the fragment that
 * plays it, so its bar is drawn there too (even though its snapped tick is past the window).
 */
export function measuresForFragment(
  score: Score,
  startSec: number,
  endSec: number,
  members: Iterable<number>,
  locations: ReadonlyMap<number, ScoreEvent> = noteLocations(score),
): Measure[] {
  const out = new Set(measuresInWindow(score, startSec, endSec).map((m) => m.index));
  for (const i of members) {
    const ev = locations.get(i);
    if (!ev) continue;
    const m = score.measures.find((x) => ev.start >= x.start && ev.start < x.start + x.length);
    if (m) out.add(m.index);
  }
  return [...out].sort((a, b) => a - b).map((i) => score.measures[i]);
}

/** Where each lesson note is first drawn: lesson-note index → event id (the attack, not a tie). */
export function noteLocations(score: Score): Map<number, ScoreEvent> {
  const out = new Map<number, ScoreEvent>();
  for (const m of score.measures)
    for (const ev of [...m.treble, ...m.bass]) if (!ev.continued) for (const n of ev.notes) out.set(n.index, ev);
  return out;
}

/** Note name for the reading aid, spelled as on the staff: "D#", "Eb" — or "Ре#", "Мі♭". */
export function spelledName(s: Spelling, system: 'letter' | 'solfege'): string {
  const acc = s.alter === 1 ? '#' : s.alter === -1 ? 'b' : '';
  if (system === 'letter') return `${s.letter}${acc}`;
  const SOLF: Record<Letter, string> = { C: 'До', D: 'Ре', E: 'Мі', F: 'Фа', G: 'Соль', A: 'Ля', B: 'Сі' };
  return `${SOLF[s.letter]}${acc}`;
}
