import { lessonDuration, slugify, sortNotes, type Fragment, type LessonInputParsed } from './lesson.ts';
import { autoFragments } from './steps.ts';

export interface PreparedLesson extends Omit<LessonInputParsed, 'slug' | 'fragments'> {
  slug: string;
  durationSec: number;
  fragments: Fragment[];
}

/** Normalise a validated input for storage: sorted notes, slug, duration, fragments. */
export function prepareLesson(input: LessonInputParsed): PreparedLesson {
  const notes = sortNotes(input.notes);
  const fragments =
    input.fragments && input.fragments.length > 0
      ? input.fragments.map((f, i) => ({ title: f.title ?? `#${i + 1}`, start: f.start, end: f.end }))
      : autoFragments(notes, { tempo: input.tempo });
  return {
    ...input,
    slug: input.slug ?? slugify(input.title),
    notes,
    durationSec: lessonDuration(notes),
    fragments,
  };
}
