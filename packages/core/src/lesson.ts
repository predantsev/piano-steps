import { z } from 'zod';

/** Most notes one lesson may have (a long piano piece has a few thousand). */
export const MAX_LESSON_NOTES = 20000;

/**
 * The lesson format — the one contract shared by the web app, the server/DB and every
 * importer (MIDI, MusicXML, transcription, an agent writing JSON by hand).
 *
 * Time is in SECONDS from the start of the lesson (MIDI-shaped, so a transcription can be
 * stored without quantising). Pitch is a MIDI note number (60 = middle C = C4).
 * Docs: docs/lesson-format.md · JSON Schema: docs/lesson.schema.json (generated).
 */

export const LESSON_SCHEMA_VERSION = 1;

export const Hand = z.enum(['L', 'R']).describe('Which hand plays the note: L = left, R = right');
export type Hand = z.infer<typeof Hand>;

export const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const LessonNote = z.object({
  id: z
    .string()
    .regex(NOTE_ID_RE, 'letters, digits, _ or -, up to 40')
    .optional()
    .describe(
      'Stable note id, unique in the lesson. Assigned by the server when missing; send it back unchanged when ' +
        'you edit a note, so reports about that note keep pointing at it.',
    ),
  pitch: z.number().int().min(21).max(108).describe('MIDI note number, 21 (A0) … 108 (C8); 60 = C4 (middle C)'),
  start: z.number().min(0).describe('Onset, seconds from lesson start'),
  duration: z.number().positive().describe('Length in seconds'),
  hand: Hand.optional(),
  velocity: z.number().min(0).max(1).optional().describe('Loudness 0…1'),
  finger: z.number().int().min(1).max(5).optional().describe('Suggested finger, 1 = thumb … 5 = little finger'),
});
export type LessonNote = z.infer<typeof LessonNote>;

export const Fragment = z.object({
  title: z.string().optional(),
  start: z.number().min(0).describe('Seconds'),
  end: z.number().positive().describe('Seconds, exclusive'),
});
export type Fragment = z.infer<typeof Fragment>;

export const SourceKind = z.enum([
  'manual',
  'midi',
  'musicxml',
  'transcription-audio',
  'transcription-video',
  'agent',
]);
export type SourceKind = z.infer<typeof SourceKind>;

export const LessonSource = z.object({
  kind: SourceKind,
  url: z.string().optional().describe('Where it came from, e.g. a YouTube URL'),
  offsetSec: z
    .number()
    .min(0)
    .optional()
    .describe('Position in the source recording (seconds) where lesson time 0 begins — lets the app play the original for a fragment'),
  note: z.string().optional().describe('Free text: how it was produced, known inaccuracies'),
});
export type LessonSource = z.infer<typeof LessonSource>;

export const Tempo = z.object({
  bpm: z.number().positive().describe('Quarter-note beats per minute'),
  timeSignature: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
});
export type Tempo = z.infer<typeof Tempo>;

/** What a client (UI, agent, importer) sends to create or replace a lesson. */
export const LessonInput = z.object({
  schemaVersion: z.literal(LESSON_SCHEMA_VERSION).default(LESSON_SCHEMA_VERSION),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes')
    .max(80)
    .optional(),
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
  composer: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  source: LessonSource.optional(),
  license: z.string().max(200).optional(),
  tempo: Tempo.optional(),
  notes: z.array(LessonNote).min(1).max(MAX_LESSON_NOTES),
  fragments: z.array(Fragment).optional().describe('Practice chunks; generated automatically when omitted'),
});
export type LessonInput = z.input<typeof LessonInput>;
export type LessonInputParsed = z.output<typeof LessonInput>;

/** A stored lesson as returned by the API. */
export interface Lesson extends Omit<LessonInputParsed, 'slug' | 'fragments'> {
  id: string;
  slug: string;
  durationSec: number;
  fragments: Fragment[];
  createdAt: string;
  updatedAt: string;
}

export interface LessonSummary {
  id: string;
  slug: string;
  title: string;
  artist?: string;
  composer?: string;
  durationSec: number;
  noteCount: number;
  fragmentCount: number;
  sourceKind?: SourceKind;
  updatedAt: string;
}

/** "This fragment sounds wrong" — written by the user, picked up and resolved by an agent. */
export const FeedbackStatus = z.enum(['open', 'in-progress', 'resolved', 'wont-fix']);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

/** What is wrong with one note, as the user hears it. */
export const FeedbackKind = z
  .enum(['higher', 'lower', 'extra', 'missing', 'timing', 'other'])
  .describe(
    'higher / lower = should be a higher / lower note; extra = should not be there; missing = a note is ' +
      'missing near it; timing = too early, too late or the wrong length; other = see the message',
  );
export type FeedbackKind = z.infer<typeof FeedbackKind>;

export const FeedbackInput = z.object({
  fragmentPosition: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Fragment index; omit for the lesson as a whole (derived from the note when `noteId` is given)'),
  noteId: z.string().regex(NOTE_ID_RE).optional().describe('The one note this is about (its stable id)'),
  kind: FeedbackKind.optional(),
  message: z.string().max(4000).default('').describe('What sounds wrong, in words; may be empty when `kind` says it'),
}).refine((v) => v.message.trim() !== '' || v.kind !== undefined, {
  message: 'say what is wrong: a message, a kind, or both',
  path: ['message'],
});
export type FeedbackInput = z.input<typeof FeedbackInput>;

export interface Feedback {
  fragmentPosition?: number;
  noteId?: string;
  /** The note as it was when reported — stays readable after the fragment is re-transcribed. */
  note?: LessonNote;
  kind?: FeedbackKind;
  message: string;
  id: string;
  lessonId: string;
  lessonSlug?: string;
  status: FeedbackStatus;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

/** Quick wishes about how a fragment is cut (input for re-splitting, #33). */
export const FragmentNoteTag = z
  .enum(['split', 'merge-next', 'boundary'])
  .describe('split = too hard, cut it smaller; merge-next = join with the next fragment; boundary = the border is in the wrong place');
export type FragmentNoteTag = z.infer<typeof FragmentNoteTag>;

/** The user's note on one fragment: free text, a "come back later" mark and quick tags. */
export const FragmentNoteInput = z.object({
  text: z.string().max(4000).default(''),
  later: z.boolean().default(false).describe('"Come back to this later"'),
  tags: z.array(FragmentNoteTag).max(3).default([]),
});
export type FragmentNoteInput = z.input<typeof FragmentNoteInput>;

export interface FragmentNote {
  fragmentPosition: number;
  text: string;
  later: boolean;
  tags: FragmentNoteTag[];
  updatedAt: string;
}

/** A note with nothing in it — saving one removes the note. */
export function isEmptyFragmentNote(n: { text?: string; later?: boolean; tags?: readonly string[] }): boolean {
  return !(n.text ?? '').trim() && !n.later && !(n.tags ?? []).length;
}

export const ProgressStatus = z.enum(['new', 'learning', 'mastered']);
export type ProgressStatus = z.infer<typeof ProgressStatus>;

export interface FragmentProgress {
  fragmentPosition: number;
  status: ProgressStatus;
  attempts: number;
  lastPracticedAt?: string;
}

export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ]+/gi, '-')
    .replace(/[а-яіїєґ]/gi, (c) => TRANSLIT[c.toLowerCase()] ?? '')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 80) || 'lesson';
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i',
  ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'io', ъ: '',
};

export function lessonDuration(notes: readonly LessonNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + n.duration);
  return Math.round(end * 1000) / 1000;
}

export function sortNotes(notes: readonly LessonNote[]): LessonNote[] {
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** A fresh note id ("n" + 10 random base-36 characters). */
export function newNoteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return 'n' + Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** Give every note without an id a fresh one (ids already present are kept). */
export function withNoteIds(notes: readonly LessonNote[]): LessonNote[] {
  const used = new Set(notes.map((n) => n.id).filter((id): id is string => !!id));
  return notes.map((n) => {
    if (n.id) return n;
    let id = newNoteId();
    while (used.has(id)) id = newNoteId();
    used.add(id);
    return { id, ...n };
  });
}

export type ValidationResult =
  | { ok: true; value: LessonInputParsed }
  | { ok: false; errors: string[] };

/** Checks the schema alone cannot express: fragment ranges and unique note ids. */
export function lessonRuleErrors(input: LessonInputParsed): string[] {
  const errors =
    input.fragments
      ?.map((f, i) => (f.end <= f.start ? `fragments.${i}: end must be after start` : null))
      .filter((e): e is string => e !== null) ?? [];
  const seen = new Set<string>();
  input.notes.forEach((n, i) => {
    if (n.id === undefined) return;
    if (seen.has(n.id)) errors.push(`notes.${i}.id: "${n.id}" is used by another note`);
    seen.add(n.id);
  });
  return errors;
}

/** Validate unknown JSON against the lesson format; errors are human-readable "path: message". */
export function validateLessonInput(data: unknown): ValidationResult {
  const r = LessonInput.safeParse(data);
  if (r.success) {
    const errors = lessonRuleErrors(r.data);
    return errors.length ? { ok: false, errors } : { ok: true, value: r.data };
  }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
