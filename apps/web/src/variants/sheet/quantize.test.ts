import {
  demoLessons,
  groupSteps,
  notesInRange,
  prepareLesson,
  validateLessonInput,
  type LessonNote,
  type Tempo,
} from '@piano-steps/core';
import { describe, expect, it } from 'vitest';
import {
  buildScore,
  estimateKeyFifths,
  estimateTempo,
  measuresForFragment,
  measuresInWindow,
  noteLocations,
  spell,
  spelledName,
  splitTicks,
  type Measure,
  type Score,
  type ScoreEvent,
} from './quantize.ts';

function demo(slug: string) {
  const input = demoLessons().find((l) => l.slug === slug)!;
  const v = validateLessonInput(input);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return prepareLesson(v.value);
}

/** Compact view of a staff in one bar: "A4:8 r:16 C4:16" (dots as "."). */
function bar(m: Measure, staff: 'treble' | 'bass'): string {
  return m[staff]
    .map((e) => {
      const what = e.notes.length ? e.notes.map((n) => `${n.letter}${n.alter === 1 ? '#' : n.alter === -1 ? 'b' : ''}${n.octave}`).join('+') : 'r';
      return `${e.continued ? '~' : ''}${what}:${e.code}${'.'.repeat(e.dots)}`;
    })
    .join(' ');
}

function expectWellFormed(score: Score) {
  let t = 0;
  for (const m of score.measures) {
    expect(m.start).toBe(t);
    for (const staff of ['treble', 'bass'] as const) {
      const evs: ScoreEvent[] = m[staff];
      expect(evs.length).toBeGreaterThan(0);
      let pos = m.start;
      for (const e of evs) {
        expect(e.start).toBe(pos);
        expect([1, 2, 3, 4, 6, 8, 12, 16]).toContain(e.dur);
        pos += e.dur;
      }
      expect(pos).toBe(m.start + m.length);
    }
    t += m.length;
  }
}

describe('sheet quantiser · demo lessons', () => {
  it('Für Elise: 3/8 with a two-sixteenth pickup, eight full bars, on the grid', () => {
    const l = demo('fur-elise-opening');
    const score = buildScore(l.notes, { tempo: l.tempo, fragments: l.fragments });
    expect(score.timeSignature).toEqual([3, 8]);
    expect(score.tempoEstimated).toBe(false);
    expect(score.snapError).toBeLessThan(0.01);
    expect(score.pickupTicks).toBe(2); // = an eighth = 0.5 quarter beats
    expect(score.measures.map((m) => m.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(score.measures[0].length).toBe(2);
    expect(score.keyFifths).toBe(0);
    expectWellFormed(score);

    expect(bar(score.measures[0], 'treble')).toBe('E5:16 D#5:16');
    expect(bar(score.measures[0], 'bass')).toBe('r:8');
    expect(bar(score.measures[1], 'treble')).toBe('E5:16 D#5:16 E5:16 B4:16 D5:16 C5:16');
    expect(bar(score.measures[1], 'bass')).toBe('r:q.');
    // the 5 % release gap of the demo notes must not turn the eighth into "16th + 32nd rest"
    expect(bar(score.measures[2], 'treble')).toBe('A4:8 r:16 C4:16 E4:16 A4:16');
    expect(bar(score.measures[2], 'bass')).toBe('A2:16 E3:16 A3:16 r:8.');
    expect(bar(score.measures[5], 'bass')).toBe('r:q.');
    expect(bar(score.measures[8], 'treble')).toBe('A4:q.');
    expect(bar(score.measures[8], 'bass')).toBe('A2:16 E3:16 A3:q');
  });

  it('Für Elise: the explicit fragments map onto whole bars', () => {
    const l = demo('fur-elise-opening');
    const score = buildScore(l.notes, { tempo: l.tempo, fragments: l.fragments });
    const nums = l.fragments.map((f) => measuresInWindow(score, f.start, f.end).map((m) => m.number));
    expect(nums).toEqual([[0, 1], [2, 3], [4, 5], [6, 7, 8]]);
  });

  it('Für Elise: the pickup is found from the notes alone (no fragments given)', () => {
    const l = demo('fur-elise-opening');
    expect(buildScore(l.notes, { tempo: l.tempo }).pickupTicks).toBe(2);
  });

  it('Ode to Joy: 4/4 from the downbeat; whole notes stay whole, dotted rhythms stay dotted', () => {
    const l = demo('ode-to-joy');
    const score = buildScore(l.notes, { tempo: l.tempo, fragments: l.fragments });
    expect(score.pickupTicks).toBe(0);
    expect(score.measures).toHaveLength(8);
    expect(score.snapError).toBeLessThan(0.01);
    expectWellFormed(score);
    expect(bar(score.measures[0], 'treble')).toBe('E4:q E4:q F4:q G4:q');
    expect(bar(score.measures[0], 'bass')).toBe('C3:w');
    expect(bar(score.measures[3], 'treble')).toBe('E4:q. D4:8 D4:h');
    expect(bar(score.measures[7], 'bass')).toBe('G2:h C3:h');
    // auto fragments (≈ 6 s → 3 bars at 100 bpm) land on bar lines
    expect(l.fragments.map((f) => measuresInWindow(score, f.start, f.end).map((m) => m.number))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8],
    ]);
  });

  it('Twinkle: 12 bars, halves and quarters', () => {
    const l = demo('twinkle-twinkle');
    const score = buildScore(l.notes, { tempo: l.tempo, fragments: l.fragments });
    expect(score.pickupTicks).toBe(0);
    expect(score.measures).toHaveLength(12);
    expectWellFormed(score);
    expect(bar(score.measures[1], 'treble')).toBe('A4:q A4:q G4:h');
    expect(bar(score.measures[1], 'bass')).toBe('F3:h C3:h');
  });

  it('every lesson note has a place on the staff', () => {
    for (const l of demoLessons().map((d) => demo(d.slug!))) {
      const score = buildScore(l.notes, { tempo: l.tempo, fragments: l.fragments });
      const loc = noteLocations(score);
      expect(loc.size).toBe(l.notes.length);
      for (const [i, ev] of loc) expect(ev.notes.some((n) => n.index === i && n.pitch === l.notes[i].pitch)).toBe(true);
    }
  });
});

describe('sheet quantiser · unquantised input degrades gracefully', () => {
  const jitter = (notes: LessonNote[], amp: number, seed = 7) => {
    let x = seed;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
    return notes.map((n) => ({ ...n, start: Math.max(0, n.start + rnd() * amp), duration: n.duration * (1 + rnd() * 0.15) }));
  };

  it('±30 ms timing jitter snaps back to the same notation', () => {
    const l = demo('ode-to-joy');
    const clean = buildScore(l.notes, { tempo: l.tempo });
    const noisy = buildScore(jitter(l.notes, 0.03), { tempo: l.tempo });
    expect(noisy.snapError).toBeGreaterThan(0.01);
    expect(noisy.measures.map((m) => bar(m, 'treble'))).toEqual(clean.measures.map((m) => bar(m, 'treble')));
    expect(noisy.measures.map((m) => bar(m, 'bass'))).toEqual(clean.measures.map((m) => bar(m, 'bass')));
  });

  it('no tempo: estimates one and still builds a well-formed score', () => {
    const l = demo('ode-to-joy');
    const est = estimateTempo(l.notes);
    expect(Math.abs(est.bpm - 100)).toBeLessThan(3);
    const score = buildScore(jitter(l.notes, 0.02), {});
    expect(score.tempoEstimated).toBe(true);
    expect(score.timeSignature).toEqual([4, 4]);
    expect(score.measures.length).toBeGreaterThanOrEqual(7);
    expectWellFormed(score);
  });

  it('random, overlapping, off-grid notes never throw and always fill every bar exactly', () => {
    let x = 42;
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 30; run++) {
      const notes: LessonNote[] = Array.from({ length: 60 }, () => ({
        pitch: 36 + Math.floor(rnd() * 50),
        start: rnd() * 20,
        duration: 0.02 + rnd() * 2,
        ...(rnd() < 0.7 ? { hand: rnd() < 0.5 ? ('L' as const) : ('R' as const) } : {}),
      }));
      const tempo: Tempo | undefined = run % 3 === 0 ? undefined : { bpm: 50 + rnd() * 120, timeSignature: run % 2 ? [3, 4] : [6, 8] };
      const score = buildScore(notes, { tempo });
      expectWellFormed(score);
      expect(noteLocations(score).size).toBe(notes.length);
    }
  });

  it('a note across a bar line is split and tied', () => {
    const tempo = { bpm: 60, timeSignature: [4, 4] as [number, number] };
    // quarter = 1 s; a 4-beat note starting on beat 3 of bar 1, over whole notes in the bass
    const score = buildScore(
      [
        { pitch: 48, start: 0, duration: 3.9, hand: 'L' },
        { pitch: 48, start: 4, duration: 3.9, hand: 'L' },
        { pitch: 64, start: 2, duration: 4, hand: 'R' },
      ],
      { tempo },
    );
    expect(score.pickupTicks).toBe(0);
    expect(bar(score.measures[0], 'treble')).toBe('r:h E4:h');
    expect(bar(score.measures[1], 'treble')).toBe('~E4:h r:h');
    expect(score.measures[0].treble[1].tieToNext).toBe(true);
  });
});

describe('sheet quantiser · helpers', () => {
  it('splits lengths into notatable values', () => {
    expect(splitTicks(5)).toEqual([4, 1]);
    expect(splitTicks(7)).toEqual([6, 1]);
    expect(splitTicks(16)).toEqual([16]);
    expect(splitTicks(20)).toEqual([16, 4]);
  });

  it('estimates the key signature, biased to fewer accidentals', () => {
    const scale = (pitches: number[]) => pitches.map((pitch, i) => ({ pitch, start: i * 0.5, duration: 0.45 }));
    expect(estimateKeyFifths(scale([67, 69, 71, 72, 74, 76, 78, 79, 78, 76]))).toBe(1); // G major with F#
    expect(estimateKeyFifths(scale([70, 72, 74, 75, 77, 79, 81, 82, 75, 70]))).toBe(-2); // Bb major
    expect(estimateKeyFifths(demo('fur-elise-opening').notes)).toBe(0); // A minor: D#, G# stay accidentals
    expect(estimateKeyFifths(scale([60, 62, 64, 65, 67, 66, 67, 69, 71, 72]))).toBe(0); // one F# passing note
  });

  it('spells in the key and names notes as written', () => {
    expect(spell(63, 0)).toEqual({ letter: 'D', alter: 1, octave: 4 });
    expect(spell(63, -3)).toEqual({ letter: 'E', alter: -1, octave: 4 });
    expect(spelledName(spell(63, -3), 'letter')).toBe('Eb');
    expect(spelledName(spell(67, 0), 'solfege')).toBe('Соль');
  });
});

describe('sheet · fragment membership and the drawn bars', () => {
  it('BOUND_EPS is redundant: the old ±5 ms shifted window picks the same notes as core on every demo fragment', () => {
    for (const l of demoLessons().map((d) => demo(d.slug!))) {
      for (const f of l.fragments) {
        const shifted = notesInRange(l.notes, Math.max(0, f.start - 0.005), f.end - 0.005);
        const core = notesInRange(l.notes, f.start, f.end);
        expect(core, `${l.slug} ${f.title}`).toEqual(shifted);
        expect(core.length).toBeGreaterThan(0);
      }
    }
  });

  it('every member note of every demo fragment is drawn in that fragment', () => {
    for (const l of demoLessons().map((d) => demo(d.slug!))) {
      const score = buildScore(l.notes, { tempo: l.tempo, fragments: l.fragments });
      const loc = noteLocations(score);
      for (const f of l.fragments) {
        const members = notesInRange(l.notes, f.start, f.end).map((n) => l.notes.indexOf(n));
        const drawn = measuresForFragment(score, f.start, f.end, members, loc);
        // nothing beyond the bar-aligned window is added on the demos
        expect(drawn.map((m) => m.index)).toEqual(measuresInWindow(score, f.start, f.end).map((m) => m.index));
      }
    }
  });

  it('a downbeat played early is a step of the fragment that plays it, and its bar is drawn there', () => {
    // 120 bpm 4/4, quarters; the downbeat of bar 4 (6.0 s) played 50 ms early
    const tempo: Tempo = { bpm: 120, timeSignature: [4, 4] };
    const notes: LessonNote[] = Array.from({ length: 24 }, (_, i) => ({
      pitch: 60 + (i % 8),
      start: i === 12 ? 5.95 : i * 0.5,
      duration: 0.45,
      hand: 'R' as const,
    }));
    const fragments = [
      { start: 0, end: 6 },
      { start: 6, end: 11.95 },
    ];
    const score = buildScore(notes, { tempo, fragments });
    const loc = noteLocations(score);
    for (const f of fragments) {
      const members = notesInRange(notes, f.start, f.end).map((n) => notes.indexOf(n));
      const drawn = measuresForFragment(score, f.start, f.end, members, loc);
      const drawnIds = new Set(drawn.flatMap((m) => [...m.treble, ...m.bass]).map((e) => e.id));
      for (const i of members) expect(drawnIds.has(loc.get(i)!.id), `note ${i} in [${f.start}, ${f.end})`).toBe(true);
      // the cursor of the last step has a head to sit on
      const steps = groupSteps(members.map((i) => notes[i]));
      expect(drawnIds.has(loc.get(notes.indexOf(steps[steps.length - 1].notes[0]))!.id)).toBe(true);
    }
    // the early note belongs to fragment 1 (seconds) and bar 4 is drawn there as well
    const first = measuresForFragment(score, 0, 6, notesInRange(notes, 0, 6).map((n) => notes.indexOf(n)), loc);
    expect(first.map((m) => m.number)).toEqual([1, 2, 3, 4]);
  });

  it("a fragment's only note just before its end is drawn", () => {
    const tempo: Tempo = { bpm: 90, timeSignature: [4, 4] };
    const notes: LessonNote[] = [{ pitch: 64, start: 7.3, duration: 0.5, hand: 'R' }];
    const f = { start: 5.333, end: 7.31 };
    const score = buildScore(notes, { tempo, fragments: [f] });
    const drawn = measuresForFragment(score, f.start, f.end, [0]);
    const ids = new Set(drawn.flatMap((m) => m.treble).map((e) => e.id));
    expect(ids.has(noteLocations(score).get(0)!.id)).toBe(true);
  });
});
