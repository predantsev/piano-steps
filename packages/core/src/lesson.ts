import { z } from 'zod';

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

export const LessonNote = z.object({
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
  notes: z.array(LessonNote).min(1).max(20000),
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

export const FeedbackInput = z.object({
  fragmentPosition: z.number().int().min(0).optional().describe('Fragment index; omit for the lesson as a whole'),
  message: z.string().min(1).max(4000),
});
export type FeedbackInput = z.infer<typeof FeedbackInput>;

export interface Feedback extends FeedbackInput {
  id: string;
  lessonId: string;
  lessonSlug?: string;
  status: FeedbackStatus;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
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

export type ValidationResult =
  | { ok: true; value: LessonInputParsed }
  | { ok: false; errors: string[] };

/** Validate unknown JSON against the lesson format; errors are human-readable "path: message". */
export function validateLessonInput(data: unknown): ValidationResult {
  const r = LessonInput.safeParse(data);
  if (r.success) {
    const fragErrors = r.data.fragments
      ?.map((f, i) => (f.end <= f.start ? `fragments.${i}: end must be after start` : null))
      .filter((e): e is string => e !== null);
    if (fragErrors && fragErrors.length) return { ok: false, errors: fragErrors };
    return { ok: true, value: r.data };
  }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
