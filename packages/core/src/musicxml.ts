import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { unzipSync } from 'fflate';
import { MAX_LESSON_NOTES, type Fragment, type Hand, type LessonInput, type LessonNote, type Tempo } from './lesson.ts';
import { notesInRange, snapFragments } from './steps.ts';

/**
 * MusicXML (`.musicxml` / `.xml`, or compressed `.mxl`) → LessonInput.
 *
 * What is read:
 * - `score-partwise` (what MuseScore, Finale, Sibelius, Dorico export). `score-timewise` is rejected.
 * - notes, rests, chords (`<chord/>`), `<backup>` / `<forward>`, `<divisions>` (may change per measure)
 * - tempo from `<sound tempo>` (preferred) or a `<metronome>` mark; changes mid-piece are honoured;
 *   before the first mark 120 bpm (the MusicXML default), unless that mark is in the first two bars
 * - ties (`<tie>` or `<notations><tied>`) are merged into one long note (per staff and voice)
 * - `<transpose>` (transposing instruments: clarinet, sax, guitar…) → notes at the sounding pitch
 * - hands: a part with two staves → staff 1 = R, staff 2 = L; two single-staff parts → the higher
 *   one is R; otherwise split at `splitPitch`
 * - fingering (`<technical><fingering>`) → `finger`
 * - fragments: groups of whole measures (~6 s), so fragment edges sit on real bar lines
 *
 * Ignored: grace notes (no duration), cue notes, unpitched percussion, repeats/voltas (the score is
 * read straight through, as written), dynamics.
 */

export interface MusicXmlImportOptions {
  title?: string;
  /** Import only these parts, by part id ("P1") or part name (case-insensitive). Default: all. */
  parts?: string[];
  /** Pitch below which a note goes to the left hand when staves/parts do not tell. Default 60 (C4). */
  splitPitch?: number;
  /** Target fragment length in seconds (whole measures are grouped). Default 6. */
  targetFragmentSec?: number;
}

export class MusicXmlError extends Error {}
/** The score (or a `.mxl` entry) is bigger than `MAX_SCORE_BYTES` unpacked. */
export class MusicXmlTooLarge extends MusicXmlError {}

/** Largest MusicXML text we parse (unpacked). A big piano score is a few MB. */
export const MAX_SCORE_BYTES = 20 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 64 * 1024;

interface El {
  name: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
}

type Raw = Record<string, unknown>;

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_BPM = 120;
const EPS = 1e-6;

const tooLarge = (what: string, bytes: number) =>
  new MusicXmlTooLarge(
    `${what} is ${(bytes / 1048576).toFixed(1)} MB unpacked; the limit is ${MAX_SCORE_BYTES / 1048576} MB`,
  );

/** Decode MusicXML bytes: unzip `.mxl` (zip), honour a byte-order mark or the XML encoding declaration. */
export function readMusicXml(data: string | Uint8Array | ArrayBuffer): string {
  if (typeof data === 'string') {
    if (data.length > MAX_SCORE_BYTES) throw tooLarge('The score', data.length);
    return data;
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return readMxl(bytes);
  if (bytes.length > MAX_SCORE_BYTES) throw tooLarge('The score', bytes.length);
  return decodeText(bytes);
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const s = new TextDecoder(declaredEncoding(bytes)).decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** `<?xml … encoding="ISO-8859-1"?>` → a TextDecoder label; UTF-8 when absent or unknown. */
function declaredEncoding(bytes: Uint8Array): string {
  const head = String.fromCharCode(...bytes.subarray(0, 200));
  const label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
  if (!label || /^utf-?16/i.test(label)) return 'utf-8'; // UTF-16 without a BOM is not something exporters write
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return 'utf-8';
  }
}

/** A `.mxl` rootfile path as written in container.xml → the zip entry name. */
function normalisePath(p: string): string {
  let out = p.trim().replace(/\\/g, '/');
  try {
    out = decodeURIComponent(out);
  } catch {
    /* not percent-encoded */
  }
  return out.replace(/^(\.\/|\/)+/, '');
}

/**
 * Unzip only what is needed — container.xml, then the one score — and refuse an entry over
 * MAX_SCORE_BYTES before inflating it (a zip bomb unpacks ~1000× its size). fflate allocates exactly
 * the declared `originalSize` and stops there, so a lying header cannot exceed the cap either.
 */
function readMxl(bytes: Uint8Array): string {
  const entries = new Map<string, number>(); // name → unpacked size
  const unzip = (want: (name: string) => boolean) => {
    try {
      return unzipSync(bytes, {
        filter: (f) => {
          entries.set(f.name, f.originalSize);
          return want(f.name);
        },
      });
    } catch (e) {
      throw new MusicXmlError(`Not a readable .mxl (zip) file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const meta = unzip((n) => n === 'META-INF/container.xml' && (entries.get(n) ?? 0) <= MAX_CONTAINER_BYTES);
  let path: string | undefined;
  const container = meta['META-INF/container.xml'];
  if (container) {
    const root = parseXml(decodeText(container));
    const rootfiles = findAll(root, 'rootfile');
    const score =
      rootfiles.find((r) => !r.attrs['media-type'] || r.attrs['media-type'].includes('musicxml')) ?? rootfiles[0];
    const declared = score?.attrs['full-path'];
    if (declared) path = [...entries.keys()].find((n) => n === normalisePath(declared));
  }
  path ??= [...entries.keys()].find((f) => !f.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(f));
  if (!path) throw new MusicXmlError('The .mxl archive contains no MusicXML score');
  const size = entries.get(path) ?? 0;
  if (size > MAX_SCORE_BYTES) throw tooLarge(`"${path}" in the .mxl`, size);
  const file = unzip((n) => n === path)[path];
  if (!file) throw new MusicXmlError('The .mxl archive contains no MusicXML score');
  return decodeText(file);
}

function parseXml(xml: string): El {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new MusicXmlError(`Not valid XML: ${valid.err.msg} (line ${valid.err.line})`);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    preserveOrder: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
  });
  const nodes = parser.parse(xml) as Raw[];
  const top = nodes.map(toEl).filter((e): e is El => e !== null);
  return { name: '#document', attrs: {}, children: top, text: '' };
}

function toEl(node: Raw): El | null {
  const name = Object.keys(node).find((k) => k !== ':@' && k !== '#text');
  if (!name) return null;
  const kids = (node[name] as Raw[]) ?? [];
  const attrs = (node[':@'] as Record<string, string> | undefined) ?? {};
  let text = '';
  const children: El[] = [];
  for (const k of kids) {
    if ('#text' in k) text += String(k['#text']);
    else {
      const el = toEl(k);
      if (el) children.push(el);
    }
  }
  return { name, attrs, children, text };
}

const child = (el: El | undefined, name: string) => el?.children.find((c) => c.name === name);
const kids = (el: El | undefined, name: string) => el?.children.filter((c) => c.name === name) ?? [];
const textOf = (el: El | undefined, name: string) => child(el, name)?.text.trim() || undefined;
function numOf(el: El | undefined, name: string): number | undefined {
  const t = textOf(el, name);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
function findAll(el: El, name: string, out: El[] = []): El[] {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/** A note in score time (quarter notes from the start), before tempo is applied. */
interface QNote {
  part: number;
  staff: number;
  pitch: number;
  startQ: number;
  durQ: number;
  finger?: number;
}

const BEAT_UNIT_Q: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, breve: 8,
};

export function musicxmlToLesson(
  data: string | Uint8Array | ArrayBuffer,
  opts: MusicXmlImportOptions = {},
): LessonInput {
  const doc = parseXml(readMusicXml(data));
  const root = doc.children.find((c) => c.name.startsWith('score-'));
  if (!root) throw new MusicXmlError('Not a MusicXML score: no <score-partwise> root element');
  if (root.name === 'score-timewise')
    throw new MusicXmlError('score-timewise is not supported; export the score as partwise MusicXML (the default)');
  if (root.name !== 'score-partwise') throw new MusicXmlError(`Unknown MusicXML root <${root.name}>`);

  const partNames = new Map<string, string>();
  for (const sp of kids(child(root, 'part-list'), 'score-part'))
    partNames.set(sp.attrs.id, textOf(sp, 'part-name') ?? '');

  let parts = kids(root, 'part');
  if (opts.parts?.length) {
    const want = opts.parts.map((p) => p.toLowerCase());
    parts = parts.filter(
      (p) => want.includes(p.attrs.id?.toLowerCase()) || want.includes((partNames.get(p.attrs.id) ?? '').toLowerCase()),
    );
    if (!parts.length) throw new MusicXmlError(`No part matches ${opts.parts.join(', ')}`);
  }
  if (!parts.length) throw new MusicXmlError('The score has no <part>');

  const qnotes: QNote[] = [];
  const tempoAt = new Map<number, number>(); // quarter position → bpm (first part that sets it wins)
  let timeSignature: [number, number] | undefined;
  const multiStaff = new Set<number>();
  let measureStarts: number[] = []; // from the first imported part — the bar lines

  parts.forEach((part, partIdx) => {
    let divisions = 1;
    let measureStart = 0;
    let barQ: number | undefined; // full-measure length from the time signature
    const open = new Map<string, QNote>(); // tie chains: `${staff}:${voice}:${pitch}` → note being extended
    const starts: number[] = [];
    // <transpose>: written → sounding pitch, in semitones; per staff (`number`) or for every staff (key 0).
    const transpose = new Map<number, number>();
    const shiftOf = (staff: number) => transpose.get(staff) ?? transpose.get(0) ?? 0;

    for (const measure of kids(part, 'measure')) {
      starts.push(measureStart);
      let cursor = 0; // in divisions, relative to the measure start
      let maxCursor = 0;
      let lastOnset = 0;
      const at = () => measureStart + cursor / divisions;
      const addTempo = (bpm: number | undefined) => {
        if (bpm && bpm > 0) {
          const q = round(at(), 1e6);
          if (!tempoAt.has(q)) tempoAt.set(q, bpm);
        }
      };

      for (const el of measure.children) {
        switch (el.name) {
          case 'attributes': {
            const d = numOf(el, 'divisions');
            if (d && d > 0) divisions = d;
            const staves = numOf(el, 'staves');
            if (staves && staves > 1) multiStaff.add(partIdx);
            for (const t of kids(el, 'transpose')) {
              const dbl = child(t, 'double');
              const semis =
                (numOf(t, 'chromatic') ?? 0) +
                12 * (numOf(t, 'octave-change') ?? 0) +
                (dbl ? (dbl.attrs.above === 'yes' ? 12 : -12) : 0);
              const n = Number(t.attrs.number);
              if (Number.isInteger(n) && n > 0) transpose.set(n, semis);
              else {
                transpose.clear();
                transpose.set(0, semis);
              }
            }
            const time = child(el, 'time');
            const beats = Number(textOf(time, 'beats'));
            const beatType = Number(textOf(time, 'beat-type'));
            if (Number.isInteger(beats) && Number.isInteger(beatType) && beats > 0 && beatType > 0) {
              timeSignature ??= [beats, beatType];
              barQ = beats * (4 / beatType);
            }
            break;
          }
          case 'backup':
            cursor = Math.max(0, cursor - (numOf(el, 'duration') ?? 0));
            break;
          case 'forward':
            cursor += numOf(el, 'duration') ?? 0;
            maxCursor = Math.max(maxCursor, cursor);
            break;
          case 'sound':
            addTempo(Number(el.attrs.tempo));
            break;
          case 'direction': {
            const sound = child(el, 'sound');
            if (sound?.attrs.tempo) addTempo(Number(sound.attrs.tempo));
            else {
              const metronome = findAll(el, 'metronome')[0];
              const perMinute = numOf(metronome, 'per-minute');
              const unit = BEAT_UNIT_Q[textOf(metronome, 'beat-unit') ?? ''];
              if (perMinute && unit) addTempo(perMinute * unit * (child(metronome, 'beat-unit-dot') ? 1.5 : 1));
            }
            break;
          }
          case 'note': {
            if (child(el, 'grace')) break; // grace notes take no time; skipped
            const dur = numOf(el, 'duration') ?? 0;
            const isChord = !!child(el, 'chord');
            const onset = isChord ? lastOnset : cursor;
            if (!isChord) {
              lastOnset = cursor;
              cursor += dur;
              maxCursor = Math.max(maxCursor, cursor);
            }
            const pitchEl = child(el, 'pitch');
            if (!pitchEl || child(el, 'rest') || child(el, 'cue') || dur <= 0) break;
            const step = STEP_PC[(textOf(pitchEl, 'step') ?? '').toUpperCase()];
            const octave = numOf(pitchEl, 'octave');
            if (step === undefined || octave === undefined) break;
            const staff = numOf(el, 'staff') ?? 1;
            const pitch = (octave + 1) * 12 + step + Math.round(numOf(pitchEl, 'alter') ?? 0) + shiftOf(staff);
            if (staff > 1) multiStaff.add(partIdx);
            const startQ = measureStart + onset / divisions;
            const durQ = dur / divisions;

            const tieTypes = [
              ...kids(el, 'tie').map((t) => t.attrs.type),
              ...kids(child(el, 'notations'), 'tied').map((t) => t.attrs.type),
            ];
            const tieStop = tieTypes.includes('stop') || tieTypes.includes('continue');
            const tieStart = tieTypes.includes('start') || tieTypes.includes('continue');
            // A same-pitch note in another voice must not break (or extend) this voice's tie.
            const key = `${staff}:${textOf(el, 'voice') ?? '1'}:${pitch}`;
            const prev = tieStop ? open.get(key) : undefined;
            if (prev && Math.abs(prev.startQ + prev.durQ - startQ) < 1 / 64) {
              prev.durQ = startQ + durQ - prev.startQ;
              if (!tieStart) open.delete(key);
              break;
            }
            const fingerText = findAll(child(el, 'notations') ?? emptyEl, 'fingering')[0]?.text.trim();
            const finger = fingerText ? Number(fingerText) : NaN;
            const q: QNote = {
              part: partIdx,
              staff,
              pitch,
              startQ,
              durQ,
              ...(Number.isInteger(finger) && finger >= 1 && finger <= 5 ? { finger } : {}),
            };
            qnotes.push(q);
            if (qnotes.length > MAX_LESSON_NOTES)
              throw new MusicXmlError(`The score has more than ${MAX_LESSON_NOTES} notes — import fewer parts (?part=…)`);
            if (tieStart) open.set(key, q);
            else open.delete(key);
            break;
          }
        }
      }
      // An empty measure (e.g. no rests written) still takes a full bar when the meter is known.
      const lengthQ = maxCursor > 0 ? maxCursor / divisions : (barQ ?? 0);
      measureStart += lengthQ;
    }
    starts.push(measureStart); // end of the last measure
    if (partIdx === 0) measureStarts = starts;
  });

  const notesQ = qnotes.filter((n) => n.pitch >= 21 && n.pitch <= 108);
  if (!notesQ.length) throw new MusicXmlError('The score has no pitched notes in the piano range');

  // ── tempo map: quarter position → seconds ────────────────────────────────
  const tempos = [...tempoAt.entries()].sort((a, b) => a[0] - b[0]);
  // Before the first mark: MusicXML's default of 120 — unless the mark sits in the first two bars (after a
  // pickup, or a beat into bar 1), where it is meant for the opening too.
  const earlyQ = measureStarts[Math.min(2, measureStarts.length - 1)] ?? 0;
  if (!tempos.length) tempos.push([0, DEFAULT_BPM]);
  else if (tempos[0][0] > EPS) tempos.unshift([0, tempos[0][0] < earlyQ - EPS ? tempos[0][1] : DEFAULT_BPM]);
  const segs: { q: number; sec: number; bpm: number }[] = [];
  for (const [q, bpm] of tempos) {
    const last = segs[segs.length - 1];
    const sec = last ? last.sec + ((q - last.q) * 60) / last.bpm : 0;
    if (last && Math.abs(last.q - q) < EPS) last.bpm = bpm;
    else segs.push({ q, sec, bpm });
  }
  const toSec = (q: number) => {
    // The last segment starting at or before q (binary search: a tempo mark in every bar is common).
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].q <= q + EPS) lo = mid;
      else hi = mid - 1;
    }
    const s = segs[lo];
    return s.sec + ((q - s.q) * 60) / s.bpm;
  };

  // ── hands ────────────────────────────────────────────────────────────────
  const split = opts.splitPitch ?? 60;
  const singleParts = parts.map((_, i) => i).filter((i) => !multiStaff.has(i) && notesQ.some((n) => n.part === i));
  const rankHand = new Map<number, Hand>();
  if (multiStaff.size === 0 && singleParts.length === 2) {
    const mean = (i: number) => {
      const ps = notesQ.filter((n) => n.part === i).map((n) => n.pitch);
      return ps.reduce((a, b) => a + b, 0) / ps.length;
    };
    const [hi, lo] = [...singleParts].sort((a, b) => mean(b) - mean(a));
    rankHand.set(hi, 'R');
    rankHand.set(lo, 'L');
  }
  const handOf = (n: QNote): Hand =>
    multiStaff.has(n.part) ? (n.staff === 1 ? 'R' : 'L') : (rankHand.get(n.part) ?? (n.pitch < split ? 'L' : 'R'));

  const notes: LessonNote[] = notesQ
    .map((n) => {
      const start = toSec(n.startQ);
      return {
        pitch: n.pitch,
        start: r(start),
        duration: r(Math.max(toSec(n.startQ + n.durQ) - start, 0.03)),
        hand: handOf(n),
        ...(n.finger ? { finger: n.finger } : {}),
      };
    })
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  // ── fragments: whole measures, about targetSec long ──────────────────────
  const fragments = measureFragments(
    measureStarts.map(toSec),
    notes,
    opts.targetFragmentSec ?? 6,
  );

  const bpm = segs[0].bpm;
  const tempo: Tempo = { bpm: r(bpm), ...(timeSignature ? { timeSignature } : {}) };
  const work = child(root, 'work');
  const title =
    opts.title ?? textOf(work, 'work-title') ?? textOf(root, 'movement-title') ?? 'Imported MusicXML';
  const composer = kids(child(root, 'identification'), 'creator').find((c) => c.attrs.type === 'composer')?.text.trim();

  return {
    title: title.slice(0, 200),
    ...(composer ? { composer: composer.slice(0, 200) } : {}),
    source: { kind: 'musicxml' },
    tempo,
    notes,
    ...(fragments.length ? { fragments } : {}),
  };
}

const emptyEl: El = { name: '', attrs: {}, children: [], text: '' };

/** Group measures (given by their start times in seconds, plus the final end) into ~targetSec chunks. */
function measureFragments(bounds: number[], notes: LessonNote[], targetSec: number): Fragment[] {
  const lengths = bounds.slice(1).map((b, i) => b - bounds[i]).filter((x) => x > EPS);
  if (!lengths.length) return [];
  const typical = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)];
  const per = Math.max(1, Math.round(targetSec / typical));
  // A pickup (first measure shorter than a typical bar) joins the first group.
  const pickup = bounds.length > 2 && bounds[1] - bounds[0] < typical * 0.75 ? 1 : 0;
  const cuts: number[] = [bounds[0]];
  for (let i = pickup + per; i < bounds.length - 1; i += per) cuts.push(bounds[i]);
  const lastNoteEnd = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  cuts.push(Math.max(bounds[bounds.length - 1], lastNoteEnd));
  const out: Fragment[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    // The same 4-decimal grid as note onsets, then snapped onto them: a downbeat is never filed
    // under the previous fragment (e.g. a bar ending at 6.6667 s at 72 bpm).
    const start = r(cuts[k]);
    const end = r(cuts[k + 1]);
    if (end > start && notesInRange(notes, start, end).length) out.push({ start, end });
  }
  return snapFragments(out, notes);
}

function r(x: number): number {
  return Math.round(x * 10000) / 10000;
}
function round(x: number, f: number): number {
  return Math.round(x * f) / f;
}
