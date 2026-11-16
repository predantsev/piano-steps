import type { LessonNote } from './lesson.ts';

/** A merge the owner made (#64): these notes of one key are played as one long note. */
export interface NoteMerge {
  id: string;
  /** Stable note ids (`LessonNote.id`), in lesson order. */
  noteIds: string[];
  createdAt?: string;
}

/**
 * The lesson's notes with merges applied: the first note of each merge lasts until the last one ends
 * (taking the strongest velocity), the others are left out. Unknown ids are ignored, so a merge whose
 * notes are gone after a re-transcription simply does nothing. The input is not changed.
 */
export function applyMerges(notes: readonly LessonNote[], merges: readonly Pick<NoteMerge, 'noteIds'>[]): LessonNote[] {
  if (!merges.length) return [...notes];
  const byId = new Map(notes.filter((n) => n.id).map((n) => [n.id!, n]));
  const drop = new Set<string>();
  const replace = new Map<string, LessonNote>();
  for (const m of merges) {
    const group = m.noteIds.map((id) => byId.get(id)).filter((n): n is LessonNote => !!n);
    if (group.length < 2) continue;
    group.sort((a, b) => a.start - b.start);
    const [head, ...rest] = group;
    const end = Math.max(...group.map((n) => n.start + n.duration));
    const velocity = group.some((n) => n.velocity !== undefined) ? Math.max(...group.map((n) => n.velocity ?? 0)) : undefined;
    replace.set(head.id!, { ...head, duration: end - head.start, ...(velocity !== undefined ? { velocity } : {}) });
    for (const n of rest) drop.add(n.id!);
  }
  return notes.filter((n) => !(n.id && drop.has(n.id))).map((n) => (n.id && replace.get(n.id)) || n);
}

/** Is `a` → `b` a mergeable pair: same key (and hand, when both have one), different notes? */
export function canMerge(a: LessonNote, b: LessonNote): boolean {
  return a !== b && a.pitch === b.pitch && (!a.hand || !b.hand || a.hand === b.hand);
}
