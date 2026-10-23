import {
  demoLessons,
  prepareLesson,
  validateLessonInput,
  type Feedback,
  type FragmentProgress,
  type Lesson,
  type LessonSummary,
  type ProgressStatus,
} from '@piano-steps/core';

/**
 * Client for the piano-steps API (same origin; Vite proxies /api in dev).
 * If the API is unreachable (static preview, server down) the app falls back to the built-in
 * demo lessons in read-only "offline" mode, so the UI never shows an empty screen.
 */

const TOKEN_KEY = 'piano-steps-api-token';

/**
 * An HTTP header carries only Latin-1, and a token is printable ASCII. Invisible characters a paste
 * brings along (spaces, zero-width spaces, BOM) are dropped; anything else outside ASCII (a token typed
 * on a Cyrillic layout) makes the token invalid — never sent, so it cannot break every request.
 */
export function cleanApiToken(raw: string): { token: string; ok: boolean } {
  const token = raw.replace(/[\s\u00ad\u180e\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '');
  return { token, ok: /^[\x21-\x7e]*$/.test(token) };
}

function token(): string | null {
  try {
    const { token: t, ok } = cleanApiToken(localStorage.getItem(TOKEN_KEY) ?? '');
    return ok && t ? t : null;
  } catch {
    return null;
  }
}

/** The API token stored on this device (Settings → API token), or null. */
export const getApiToken = token;

/** Store the token typed in Settings. Returns false (and stores nothing) when it cannot be sent. */
export function setApiToken(raw: string | null): boolean {
  const { token: t, ok } = cleanApiToken(raw ?? '');
  try {
    if (ok && t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
  return ok;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: string[]) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  // The server checks the token on writes only; reads never carry it, so a bad token cannot break loading.
  if (t && method !== 'GET') headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (raw !== undefined) headers['content-type'] = 'application/octet-stream';
  const r = await fetch(path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Errors are { error: <code>, details?: string[] }; show the first detail unless the caller lists them all.
    const { error, details } = data as { error?: string; details?: string[] };
    const code = error ?? r.statusText;
    throw new ApiError(code !== 'validation' && details?.length ? details[0] : code, r.status, details);
  }
  return data as T;
}

export interface Health {
  ok: boolean;
  db: string;
  /** The server has API_TOKEN set: writes need the token (Settings → API token). */
  auth: boolean;
}

export async function getHealth(): Promise<Health> {
  return call<Health>('GET', '/api/health');
}

let offline = false;
export const isOffline = () => offline;

function offlineLessons(): Lesson[] {
  const now = new Date(0).toISOString();
  return demoLessons().map((d) => {
    const v = validateLessonInput(d);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const p = prepareLesson(v.value);
    return { ...p, id: p.slug, createdAt: now, updatedAt: now };
  });
}

export async function listLessons(): Promise<LessonSummary[]> {
  try {
    const { lessons } = await call<{ lessons: LessonSummary[] }>('GET', '/api/lessons');
    offline = false;
    return lessons;
  } catch (e) {
    if (e instanceof ApiError && e.status !== 404 && e.status < 500) throw e;
    offline = true;
    return offlineLessons().map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      ...(l.composer ? { composer: l.composer } : {}),
      durationSec: l.durationSec,
      noteCount: l.notes.length,
      fragmentCount: l.fragments.length,
      updatedAt: l.updatedAt,
    }));
  }
}

export async function getLesson(ref: string): Promise<Lesson> {
  if (offline) {
    const l = offlineLessons().find((x) => x.slug === ref || x.id === ref);
    if (!l) throw new ApiError('not found', 404);
    return l;
  }
  return call<Lesson>('GET', `/api/lessons/${encodeURIComponent(ref)}`);
}

export async function createLesson(input: unknown, opts: { upsert?: boolean } = {}): Promise<Lesson> {
  return call<Lesson>('POST', `/api/lessons${opts.upsert ? '?upsert=true' : ''}`, input);
}

export async function importMidi(file: File, title?: string): Promise<Lesson> {
  const q = new URLSearchParams();
  if (title) q.set('title', title);
  return call<Lesson>('POST', `/api/lessons/import/midi?${q}`, undefined, await file.arrayBuffer());
}

/** MusicXML (.musicxml / .xml) or compressed .mxl; the title comes from the score unless given. */
export async function importMusicXml(file: File, title?: string): Promise<Lesson> {
  const q = new URLSearchParams();
  if (title) q.set('title', title);
  return call<Lesson>('POST', `/api/lessons/import/musicxml?${q}`, undefined, await file.arrayBuffer());
}

// progress falls back to localStorage when offline
const progressKey = (ref: string) => `piano-steps-progress:${ref}`;

export async function getProgress(ref: string): Promise<FragmentProgress[]> {
  if (offline) {
    try {
      return JSON.parse(localStorage.getItem(progressKey(ref)) ?? '[]') as FragmentProgress[];
    } catch {
      return [];
    }
  }
  return (await call<{ progress: FragmentProgress[] }>('GET', `/api/lessons/${encodeURIComponent(ref)}/progress`)).progress;
}

export async function recordProgress(
  ref: string,
  input: { fragmentPosition: number; status?: ProgressStatus; attempt?: boolean },
): Promise<FragmentProgress[]> {
  if (offline) {
    const list = await getProgress(ref);
    let p = list.find((x) => x.fragmentPosition === input.fragmentPosition);
    if (!p) list.push((p = { fragmentPosition: input.fragmentPosition, status: 'learning', attempts: 0 }));
    if (input.status) p.status = input.status;
    if (input.attempt) p.attempts++;
    p.lastPracticedAt = new Date().toISOString();
    try {
      localStorage.setItem(progressKey(ref), JSON.stringify(list));
    } catch {
      /* ignore */
    }
    return list;
  }
  return (
    await call<{ progress: FragmentProgress[] }>('POST', `/api/lessons/${encodeURIComponent(ref)}/progress`, input)
  ).progress;
}

export async function sendFeedback(ref: string, input: { fragmentPosition?: number; message: string }): Promise<Feedback> {
  if (offline) throw new ApiError('offline: feedback needs the server', 503);
  return call<Feedback>('POST', `/api/lessons/${encodeURIComponent(ref)}/feedback`, input);
}
