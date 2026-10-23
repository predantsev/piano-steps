import ToneMidi from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import {
  autoFragments,
  demoLessons,
  groupSteps,
  keyboardRange,
  midiToLesson,
  notesInRange,
  parsePitch,
  parseVoice,
  pitchName,
  prepareLesson,
  slugify,
  validateLessonInput,
} from './index.ts';

const { Midi } = ToneMidi as unknown as typeof import('@tonejs/midi');

describe('notes', () => {
  it('names and parses pitches both ways', () => {
    expect(pitchName(60)).toBe('C4');
    expect(pitchName(61)).toBe('C#4');
    expect(pitchName(69, 'solfege')).toBe('Ля4');
    expect(parsePitch('C4')).toBe(60);
    expect(parsePitch('Bb3')).toBe(58);
    expect(parsePitch('A0')).toBe(21);
    expect(parsePitch('Соль#3')).toBe(56);
    for (let p = 21; p <= 108; p++) expect(parsePitch(pitchName(p))).toBe(p);
  });

  it('keyboard range snaps to whole octaves and a minimum width', () => {
    expect(keyboardRange([64, 67])).toEqual([48, 83]);
    const [lo, hi] = keyboardRange([40, 88]);
    expect(lo % 12).toBe(0);
    expect(hi % 12).toBe(11);
  });
});

describe('seq + steps', () => {
  it('parses a voice with chords and rests', () => {
    const n = parseVoice('C4/1 r/1 C4+E4+G4/2', { bpm: 60, hand: 'R' });
    expect(n).toHaveLength(4);
    expect(n[1].start).toBe(2);
    const steps = groupSteps(n);
    expect(steps).toHaveLength(2);
    expect(steps[1].pitches).toEqual([60, 64, 67]);
  });

  it('auto-fragments by bars when the tempo is known', () => {
    const notes = parseVoice('C4 D4 E4 F4 | G4 A4 B4 C5 | C5 B4 A4 G4 | F4 E4 D4 C4', { bpm: 120 });
    const fr = autoFragments(notes, { tempo: { bpm: 120, timeSignature: [4, 4] }, targetSec: 4 });
    expect(fr).toHaveLength(2);
    expect(fr[0]).toMatchObject({ start: 0, end: 4 });
  });

  it('auto-fragments by gaps without a tempo', () => {
    const notes = parseVoice('C4 D4 E4 F4 G4 r/3 C5 D5 E5 F5 G5', { bpm: 60 });
    const fr = autoFragments(notes, { targetSec: 6 });
    expect(fr.length).toBeGreaterThanOrEqual(2);
    expect(fr[1].start).toBe(8); // cut right where the long rest ends
  });
});

describe('lesson validation + demo lessons', () => {
  it('every demo lesson validates and prepares', () => {
    for (const d of demoLessons()) {
      const v = validateLessonInput(d);
      expect(v.ok, JSON.stringify(!v.ok && v.errors)).toBe(true);
      if (!v.ok) continue;
      const p = prepareLesson(v.value);
      expect(p.fragments.length).toBeGreaterThan(0);
      expect(p.durationSec).toBeGreaterThan(5);
    }
  });

  it('every fragment starts exactly on its first onset and no note is lost or doubled', () => {
    for (const d of demoLessons()) {
      const v = validateLessonInput(d);
      if (!v.ok) throw new Error(v.errors.join('; '));
      const p = prepareLesson(v.value);
      let total = 0;
      for (const f of p.fragments) {
        const inside = notesInRange(p.notes, f.start, f.end);
        total += inside.length;
        expect(inside.length, `${p.slug} ${f.title}`).toBeGreaterThan(0);
        expect(Math.min(...inside.map((n) => n.start)), `${p.slug} ${f.title}`).toBeCloseTo(f.start, 6);
      }
      expect(total, p.slug).toBe(p.notes.length);
    }
  });

  it('twinkle splits into 2-bar fragments of 8 right-hand onsets', () => {
    const v = validateLessonInput(demoLessons().find((d) => d.slug === 'twinkle-twinkle'));
    if (!v.ok) throw new Error(v.errors.join('; '));
    const p = prepareLesson(v.value);
    const rh = p.fragments.map((f) => notesInRange(p.notes, f.start, f.end).filter((n) => n.hand === 'R').length);
    expect(rh).toEqual([7, 7, 7, 7, 7, 7]);
  });

  it('reports readable errors', () => {
    const v = validateLessonInput({ title: '', notes: [{ pitch: 200, start: -1, duration: 0 }] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join('\n')).toMatch(/notes\.0\.pitch/);
  });

  it('slugifies Ukrainian titles', () => {
    expect(slugify('Щедрик — Леонтович')).toBe('shchedryk-leontovych');
  });
});

describe('midi import', () => {
  it('round-trips a two-track MIDI file into hands', () => {
    const m = new Midi();
    m.header.setTempo(100);
    const rh = m.addTrack();
    rh.addNote({ midi: 64, time: 0, duration: 0.5 });
    rh.addNote({ midi: 67, time: 0.6, duration: 0.5 });
    const lh = m.addTrack();
    lh.addNote({ midi: 48, time: 0, duration: 1.2 });
    const lesson = midiToLesson(m.toArray(), { title: 'Test' });
    const v = validateLessonInput(lesson);
    expect(v.ok).toBe(true);
    expect(lesson.notes).toHaveLength(3);
    expect(lesson.notes.find((n) => n.pitch === 48)?.hand).toBe('L');
    expect(lesson.notes.find((n) => n.pitch === 67)?.hand).toBe('R');
    expect(lesson.tempo?.bpm).toBe(100);
  });
});
