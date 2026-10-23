import ToneMidi from '@tonejs/midi';
import type { Hand, LessonInput, LessonNote, Tempo } from './lesson.ts';

// @tonejs/midi ships CJS; this works in Node (tsx) and in Vite.
const { Midi } = ToneMidi as unknown as typeof import('@tonejs/midi');

export interface MidiImportOptions {
  title?: string;
  /** Pitch below which a note goes to the left hand when tracks do not tell us. Default 60 (C4). */
  splitPitch?: number;
}

/**
 * Standard MIDI file → LessonInput.
 * Hands: two+ tracks with notes → the track with the higher mean pitch is R, the next is L
 * (piano MIDI files are usually exported that way); one track → split at `splitPitch`.
 */
export function midiToLesson(data: ArrayBuffer | Uint8Array, opts: MidiImportOptions = {}): LessonInput {
  const midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data));
  const split = opts.splitPitch ?? 60;
  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && t.channel !== 9); // skip drums
  if (tracks.length === 0) throw new Error('MIDI file has no (non-drum) notes');

  const handOf = new Map<number, Hand | undefined>();
  if (tracks.length >= 2) {
    const ranked = tracks
      .map((t, i) => ({ i, mean: t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length }))
      .sort((a, b) => b.mean - a.mean);
    handOf.set(ranked[0].i, 'R');
    handOf.set(ranked[1].i, 'L');
  }

  const notes: LessonNote[] = [];
  tracks.forEach((t, i) => {
    for (const n of t.notes) {
      if (n.midi < 21 || n.midi > 108 || n.duration <= 0) continue;
      const hand: Hand = handOf.get(i) ?? (n.midi < split ? 'L' : 'R');
      notes.push({
        pitch: n.midi,
        start: r(n.time),
        duration: r(Math.max(n.duration, 0.03)),
        hand,
        velocity: r(n.velocity),
      });
    }
  });
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  // Drop leading silence so the lesson starts on the first note.
  const offset = notes[0]?.start ?? 0;
  if (offset > 0.05) for (const n of notes) n.start = r(n.start - offset);

  let tempo: Tempo | undefined;
  const bpm = midi.header.tempos[0]?.bpm;
  if (bpm && bpm > 0) {
    const ts = midi.header.timeSignatures[0]?.timeSignature;
    tempo = { bpm: r(bpm), ...(ts && ts.length === 2 ? { timeSignature: [ts[0], ts[1]] as [number, number] } : {}) };
    // only keep the tempo if leading silence was not trimmed (bar grid would be off otherwise)
    if (offset > 0.05) tempo = { bpm: tempo.bpm };
  }

  const title = opts.title ?? (midi.name?.trim() || 'Imported MIDI');
  return {
    title,
    source: { kind: 'midi' },
    ...(tempo ? { tempo } : {}),
    notes,
  };
}

function r(x: number): number {
  return Math.round(x * 10000) / 10000;
}
