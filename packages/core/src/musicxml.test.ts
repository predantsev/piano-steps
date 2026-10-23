import { strToU8, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  lessonToMidi,
  midiToLesson,
  MusicXmlError,
  musicxmlToLesson,
  notesInRange,
  prepareLesson,
  validateLessonInput,
} from './index.ts';
import { demoLessons } from './demo.ts';

const fixture = readFileSync(new URL('./fixtures/two-hands.musicxml', import.meta.url), 'utf8');

const brief = (notes: { pitch: number; start: number; duration: number; hand?: string; finger?: number }[]) =>
  notes.map((n) => [n.pitch, n.start, n.duration, n.hand, ...(n.finger ? [n.finger] : [])]);

describe('musicxmlToLesson', () => {
  it('reads the two-staff fixture: chords, rests, backup/forward, ties, tempo changes, hands', () => {
    const l = musicxmlToLesson(fixture);
    expect(l.title).toBe('Test Piece');
    expect(l.composer).toBe('Test Composer');
    expect(l.source).toEqual({ kind: 'musicxml' });
    // <sound tempo="120"> wins over the metronome mark (90) at the same spot
    expect(l.tempo).toEqual({ bpm: 120, timeSignature: [4, 4] });
    expect(brief(l.notes)).toEqual([
      // m1 — 120 bpm, quarter = 0.5 s
      [48, 0, 1, 'L'], //  C3 half (staff 2)
      [60, 0, 0.5, 'R', 1], // C4 quarter, finger 1
      [64, 0.5, 0.5, 'R'], // E4 + G4 chord
      [67, 0.5, 0.5, 'R'],
      [43, 1.5, 0.5, 'L'], // G2 after a <forward> of one quarter
      [67, 1.5, 1.5, 'R'], // G4 quarter tied over the bar line to a half → 3 quarters
      // m2 — starts at 2.0 s; the grace note is skipped
      [48, 2, 2, 'L'], // C3 whole
      [65, 3, 1, 'R'], // F4 + F4 tied with <notations><tied>
      // m3 — starts at 4.0 s; divisions 4; half = 30 → quarter = 1 s
      [45, 4, 2, 'L'], // A2 half
      [72, 4, 1, 'R'], // C5 quarter
      [75, 5, 0.5, 'R'], // D#5 eighth (alter 1); then an eighth rest; the cue note takes a quarter
      [70, 7, 1, 'R'], // Bb4 (alter -1)
    ]);
  });

  it('cuts fragments on bar lines', () => {
    expect(musicxmlToLesson(fixture).fragments).toEqual([{ start: 0, end: 8 }]);
    expect(musicxmlToLesson(fixture, { targetFragmentSec: 2 }).fragments).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 8 },
    ]);
  });

  it('produces a valid lesson that keeps its fragments', () => {
    const v = validateLessonInput(musicxmlToLesson(fixture, { title: 'Override', targetFragmentSec: 2 }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const p = prepareLesson(v.value);
    expect(p.title).toBe('Override');
    expect(p.slug).toBe('override');
    expect(p.fragments.map((f) => [f.start, f.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 8],
    ]);
  });

  it('reads compressed .mxl (with and without META-INF/container.xml) and a UTF-16 file', () => {
    const container = `<?xml version="1.0" encoding="UTF-8"?>
      <container><rootfiles><rootfile full-path="score/piece.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    const mxl = zipSync({ 'META-INF/container.xml': strToU8(container), 'score/piece.musicxml': strToU8(fixture) });
    expect(musicxmlToLesson(mxl).notes).toHaveLength(12);
    const bare = zipSync({ 'piece.xml': strToU8(fixture) });
    expect(musicxmlToLesson(bare.buffer as ArrayBuffer).notes).toHaveLength(12);

    const utf16 = new Uint8Array(2 + fixture.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < fixture.length; i++) {
      utf16[2 + i * 2] = fixture.charCodeAt(i) & 0xff;
      utf16[3 + i * 2] = fixture.charCodeAt(i) >> 8;
    }
    expect(musicxmlToLesson(utf16).notes).toHaveLength(12);
  });

  it('assigns hands across two single-staff parts by pitch, and can pick parts', () => {
    const part = (id: string, step: string, octave: number) => `
      <part id="${id}"><measure number="1">
        <attributes><divisions>1</divisions></attributes>
        <note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration></note>
        <note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration></note>
      </measure></part>`;
    const xml = `<score-partwise><part-list>
        <score-part id="P1"><part-name>Bass</part-name></score-part>
        <score-part id="P2"><part-name>Melody</part-name></score-part>
      </part-list>${part('P1', 'C', 3)}${part('P2', 'E', 5)}</score-partwise>`;
    const l = musicxmlToLesson(xml);
    expect(l.tempo?.bpm).toBe(120); // MusicXML default when the score has no tempo
    expect(l.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [48, 'L'],
      [76, 'R'],
      [48, 'L'],
      [76, 'R'],
    ]);
    const melody = musicxmlToLesson(xml, { parts: ['melody'] });
    expect(melody.notes.map((n) => n.pitch)).toEqual([76, 76]);
    expect(() => musicxmlToLesson(xml, { parts: ['nope'] })).toThrow(MusicXmlError);
  });

  it('rejects what it cannot read with a readable MusicXmlError', () => {
    expect(() => musicxmlToLesson('<score-partwise><part')).toThrow(/Not valid XML/);
    expect(() => musicxmlToLesson('<html></html>')).toThrow(/no <score-partwise>/);
    expect(() => musicxmlToLesson('<score-timewise></score-timewise>')).toThrow(/timewise/);
    expect(() => musicxmlToLesson('<score-partwise><part id="P1"><measure/></part></score-partwise>')).toThrow(
      /no pitched notes/,
    );
    expect(() => musicxmlToLesson(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(MusicXmlError);
  });
});

/** A one-part score: `bars` measures of 4/4, each four quarter notes C5 D5 E5 F5; optional extra XML per part. */
function scale(opts: { bpm?: number; bars?: number; attrs?: string; step?: string; octave?: number } = {}): string {
  const { bars = 8, attrs = '', step, octave } = opts;
  const note = (s: string, o: number) =>
    `<note><pitch><step>${s}</step><octave>${o}</octave></pitch><duration>1</duration><voice>1</voice></note>`;
  const measures = Array.from({ length: bars }, (_, i) => {
    const head =
      i === 0
        ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${attrs}</attributes>` +
          (opts.bpm ? `<sound tempo="${opts.bpm}"/>` : '')
        : '';
    const body = step ? note(step, octave ?? 4).repeat(4) : ['C', 'D', 'E', 'F'].map((s) => note(s, 5)).join('');
    return `<measure number="${i + 1}">${head}${body}</measure>`;
  }).join('');
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>X</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

describe('musicxmlToLesson fragment edges', () => {
  // At these tempos a bar ends on a time that rounds differently at 3 and 4 decimals (e.g. 6.6667 s).
  it.each([66, 72, 90])('puts every downbeat in its own fragment at %i bpm (as imported and as stored)', (bpm) => {
    const imported = musicxmlToLesson(scale({ bpm }));
    const v = validateLessonInput(imported);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const stored = prepareLesson(v.value);
    for (const l of [imported, stored]) {
      const frs = l.fragments!;
      expect(frs.length).toBeGreaterThan(1);
      for (const f of frs) {
        const inside = notesInRange(l.notes, f.start, f.end);
        expect(inside[0].start).toBe(f.start); // starts on its downbeat…
        expect(inside[0].pitch).toBe(72); // …which is the bar's C5
        expect(inside.length % 4).toBe(0); // whole bars only
      }
    }
  });
});

describe('lessonToMidi', () => {
  it('round-trips a demo lesson through MIDI with two tracks by hand', () => {
    const v = validateLessonInput(demoLessons().find((d) => d.slug === 'ode-to-joy'));
    if (!v.ok) throw new Error(v.errors.join('; '));
    const lesson = prepareLesson(v.value);
    const bytes = lessonToMidi(lesson);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]); // "MThd"

    const back = midiToLesson(bytes);
    expect(back.tempo).toEqual({ bpm: 100, timeSignature: [4, 4] });
    expect(back.notes).toHaveLength(lesson.notes.length);
    const key = (n: { pitch: number; start: number; hand?: string }) => `${n.pitch}@${n.start.toFixed(2)}:${n.hand}`;
    expect(back.notes.map(key).sort()).toEqual(lesson.notes.map(key).sort());
  });
});
