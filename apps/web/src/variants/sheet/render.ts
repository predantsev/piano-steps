import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice,
  VoiceMode,
  type SVGContext,
} from 'vexflow/bravura';
import { KEY_NAMES, spelledName, type Measure, type Score, type ScoreEvent, type Staff } from './quantize.ts';

/**
 * Draws the bars of one fragment as a grand staff with VexFlow, fitted to the container width,
 * wrapping into more lines (systems) when the bars do not fit on one, and returns where every
 * note head ended up so the component can hit-test taps, move the cursor and toggle highlights
 * without drawing again.
 *
 * Coordinates: everything returned is in the SVG's own units ("logical px"); the SVG is scaled
 * to the container with a viewBox, `zoom` = CSS px per logical px.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN_X = 12;
/** Extra room left of the first stave for the grand-staff brace (drawn left of the stave's x). */
const BRACE_PAD = 8;
const LINE = 10; // VexFlow staff-line spacing
const STAFF_H = 4 * LINE;

export interface DrawnHead {
  x: number;
  y: number;
  pitch: number;
  /** Lesson-note index. */
  index: number;
  eventId: string;
  staff: Staff;
  /** A tied continuation (not a new key press). */
  tied: boolean;
  el: Element | null;
  label: SVGTextElement | null;
}

export interface DrawnEvent {
  ev: ScoreEvent;
  x: number;
  system: number;
  el: Element | null;
}

export interface Drawn {
  svg: SVGSVGElement;
  width: number;
  height: number;
  zoom: number;
  heads: DrawnHead[];
  events: Map<string, DrawnEvent>;
  systems: Array<{ top: number; bottom: number }>;
  cursor: SVGRectElement;
}

export interface DrawOptions {
  /** Container size in CSS px. */
  width: number;
  height: number;
  names: boolean;
  nameSystem: 'letter' | 'solfege';
  /** Lesson-note indices that belong to the fragment (others are drawn faded). */
  inside: ReadonlySet<number>;
  /** Fragment window in ticks; rests outside it are faded. */
  window: [number, number];
  /** The score's very last bar is among the drawn ones → final bar line. */
  isLast: boolean;
  /** Unique per drawing (VexFlow ids are document-global). */
  idPrefix: string;
}

/** Resolve when the Bravura music font is usable (VexFlow 5 measures glyphs with it). */
export async function musicFontReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load('30px Bravura');
  } catch {
    /* draw anyway */
  }
}

/** Diatonic step number (C0 = 0, D0 = 1, …) — staff position without the accidental. */
function dia(n: { letter: string; octave: number }): number {
  return n.octave * 7 + 'CDEFGAB'.indexOf(n.letter);
}
const TREBLE_TOP = 38; // F5
const TREBLE_BOTTOM = 30; // E4
const BASS_TOP = 26; // A3
const BASS_BOTTOM = 18; // G2

/**
 * Numeric duration codes: VexFlow 5's beam grouping (`Beam.generateBeams` → sanitizeGroups) decides
 * "unbeamable" with `parseInt(duration) < 8`, which is NaN — never true — for 'q'/'h'/'w'; with
 * letters a quarter inside a 3/8 group silently cancels the beam of the sixteenths before it.
 */
const VEX_DURATION: Record<string, string> = { w: '1', h: '2', q: '4', '8': '8', '16': '16' };

interface Built {
  m: Measure;
  tv: Voice;
  bv: Voice;
  notes: Map<string, StaveNote>; // event id → note
  beams: Beam[];
  beamStaff: Staff[];
  fmt: Formatter;
  minW: number;
}

function beamGroups(score: Score): Fraction[] | undefined {
  const [num, den] = score.timeSignature;
  if (den === 8 && num % 3 === 0) return [new Fraction(3, 8)];
  return undefined; // VexFlow default: by quarter
}

function buildMeasure(m: Measure, score: Score, prefix: string, nameW: number): Built {
  const notes = new Map<string, StaveNote>();
  const make = (staff: Staff, evs: ScoreEvent[]) =>
    evs.map((e) => {
      const rest = e.notes.length === 0;
      const sn = new StaveNote({
        keys: rest ? [staff === 'treble' ? 'b/4' : 'd/3'] : e.notes.map((n) => n.key),
        duration: VEX_DURATION[e.code] ?? e.code,
        dots: e.dots,
        type: rest ? 'r' : undefined,
        clef: staff,
        autoStem: true,
        alignCenter: rest && evs.length === 1,
      });
      if (e.dots) Dot.buildAndAttach([sn], { all: true });
      sn.setAttribute('id', `${prefix}-${e.id}`);
      notes.set(e.id, sn);
      return sn;
    });
  const tNotes = make('treble', m.treble);
  const bNotes = make('bass', m.bass);
  const voice = (ns: StaveNote[]) =>
    new Voice({ numBeats: m.length, beatValue: 16 }).setMode(VoiceMode.SOFT).addTickables(ns);
  const tv = voice(tNotes);
  const bv = voice(bNotes);
  const key = KEY_NAMES[score.keyFifths] ?? 'C';
  Accidental.applyAccidentals([tv], key);
  Accidental.applyAccidentals([bv], key);
  const groups = beamGroups(score);
  const tBeams = Beam.generateBeams(tNotes, groups ? { groups } : {});
  const bBeams = Beam.generateBeams(bNotes, groups ? { groups } : {});
  const beams = [...tBeams, ...bBeams];
  const beamStaff: Staff[] = [...tBeams.map(() => 'treble' as const), ...bBeams.map(() => 'bass' as const)];
  const fmt = new Formatter();
  fmt.joinVoices([tv]);
  fmt.joinVoices([bv]);
  const vexMin = fmt.preCalculateMinTotalWidth([tv, bv]);
  // with note names on, every attack needs room for its label
  const attacks = new Set([...m.treble, ...m.bass].filter((e) => e.notes.length && !e.continued).map((e) => e.start)).size;
  const minW = Math.max(vexMin * 1.35 + 24, attacks * nameW + 16, 70);
  return { m, tv, bv, notes, beams, beamStaff, fmt, minW };
}

/** Width of clef + key + time signature at the start of a line. */
function headerWidth(score: Score, withTime: boolean): number {
  const key = KEY_NAMES[score.keyFifths] ?? 'C';
  const s = new Stave(0, 0, 400).addClef('treble');
  if (score.keyFifths) s.addKeySignature(key);
  if (withTime) s.addTimeSignature(`${score.timeSignature[0]}/${score.timeSignature[1]}`);
  const b = new Stave(0, 0, 400).addClef('bass');
  if (score.keyFifths) b.addKeySignature(key);
  if (withTime) b.addTimeSignature(`${score.timeSignature[0]}/${score.timeSignature[1]}`);
  return Math.max(s.getNoteStartX(), b.getNoteStartX()) + 4;
}

function pack(widths: number[], usable: number, head0: number, headN: number): number[][] {
  const systems: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  widths.forEach((w, i) => {
    const head = systems.length === 0 ? head0 : headN;
    if (cur.length && used + w > usable - head) {
      systems.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += w;
  });
  if (cur.length) systems.push(cur);
  return systems;
}

export function drawFragment(container: HTMLElement, score: Score, measures: Measure[], opts: DrawOptions): Drawn {
  container.replaceChildren();
  const nameW = opts.names ? (opts.nameSystem === 'solfege' ? 40 : 28) : 0;
  const built = measures.map((m) => buildMeasure(m, score, opts.idPrefix, nameW));

  // vertical extents from the pitches actually drawn
  const pitched = (staff: Staff) => measures.flatMap((m) => m[staff].flatMap((e) => e.notes));
  const tr = pitched('treble');
  const bs = pitched('bass');
  const trMax = tr.length ? Math.max(...tr.map(dia)) : TREBLE_TOP;
  const trMin = tr.length ? Math.min(...tr.map(dia)) : TREBLE_BOTTOM;
  const bsMax = bs.length ? Math.max(...bs.map(dia)) : BASS_TOP;
  const bsMin = bs.length ? Math.min(...bs.map(dia)) : BASS_BOTTOM;
  const chordRows = (staff: Staff) =>
    Math.min(4, Math.max(1, ...measures.flatMap((m) => m[staff].map((e) => (e.continued ? 0 : e.notes.length)))));
  const rowH = 15;
  const namesT = opts.names ? chordRows('treble') * rowH + 6 : 0;
  const namesB = opts.names ? chordRows('bass') * rowH + 6 : 0;
  const above = Math.max(0, (trMax - TREBLE_TOP) * 5) + 34; // ledger notes above + stems/bar numbers
  const trBelow = Math.max(0, (TREBLE_BOTTOM - trMin) * 5);
  const bsAbove = Math.max(0, (bsMax - BASS_TOP) * 5);
  const below = Math.max(0, (BASS_BOTTOM - bsMin) * 5);
  const namesTOffset = Math.max(30, trBelow + 18); // treble names baseline below the treble bottom line
  const gap = Math.max(64, namesTOffset + namesT + Math.max(28, bsAbove + 14));
  const namesBOffset = Math.max(32, below + 20);
  const sysH = above + STAFF_H + gap + STAFF_H + (opts.names ? namesBOffset + namesB : Math.max(30, below + 16)) + 8;

  // zoom: as large as fits the height, never so large that one line holds less than the bars need
  const head0 = headerWidth(score, true);
  const headN = headerWidth(score, false);
  const widths = built.map((b) => b.minW);
  let zoom = 0.6;
  let systems: number[][] = [];
  for (let k = 0; k <= 20; k++) {
    const z = Math.round((1.6 - k * 0.05) * 100) / 100; // 1.6 … 0.6
    const usable = opts.width / z - 2 * MARGIN_X - BRACE_PAD;
    const s = pack(widths, usable, head0, headN);
    const fitsWidth = s.every((sys, j) => sys.reduce((a, i) => a + widths[i], 0) <= usable - (j === 0 ? head0 : headN) + 1 || sys.length === 1);
    if (fitsWidth && s.length * sysH * z <= opts.height) {
      zoom = z;
      systems = s;
      break;
    }
    zoom = z;
    systems = s;
  }
  const L = opts.width / zoom;
  const usable = L - 2 * MARGIN_X - BRACE_PAD;

  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(L, systems.length * sysH);
  const ctx = renderer.getContext() as SVGContext;
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');
  const svg = container.querySelector('svg') as SVGSVGElement;
  svg.classList.add('ps-svg');

  const cursor = document.createElementNS(SVG_NS, 'rect');
  cursor.setAttribute('class', 'ps-cursor');
  cursor.setAttribute('rx', '6');
  svg.insertBefore(cursor, svg.firstChild);
  const labels = document.createElementNS(SVG_NS, 'g');
  labels.setAttribute('class', 'ps-labels');
  labels.setAttribute('stroke', 'none');

  const key = KEY_NAMES[score.keyFifths] ?? 'C';
  const events = new Map<string, DrawnEvent>();
  const heads: DrawnHead[] = [];
  const sysBoxes: Drawn['systems'] = [];
  const noteSystem = new Map<string, number>();

  let top = 0;
  const ext = (el: Element | null | undefined, acc: { min: number; max: number }) => {
    if (!el) return;
    try {
      const bb = (el as SVGGraphicsElement).getBBox();
      if (bb.height > 0) {
        acc.min = Math.min(acc.min, bb.y);
        acc.max = Math.max(acc.max, bb.y + bb.height);
      }
    } catch {
      /* not rendered */
    }
  };

  systems.forEach((sys, si) => {
    const trebleTop = top + above;
    const bassTop = trebleTop + STAFF_H + gap;
    const head = si === 0 ? head0 : headN;
    const total = sys.reduce((a, i) => a + widths[i], 0);
    // < 1 only when a single bar is wider than the screen even at the smallest zoom: squeeze, never scroll
    const stretch = (usable - head) / total;
    let x = MARGIN_X + BRACE_PAD;
    // drawn extent of each staff's notes, stems and beams (for placing the note names)
    const tExt = { min: Infinity, max: -Infinity };
    const bExt = { min: Infinity, max: -Infinity };
    sys.forEach((bi, k) => {
      const b = built[bi];
      const w = widths[bi] * stretch + (k === 0 ? head : 0);
      // VexFlow puts the top line 4 spaces below the stave's y
      const t = new Stave(x, trebleTop - 4 * LINE, w);
      const bsv = new Stave(x, bassTop - 4 * LINE, w);
      if (k === 0) {
        t.addClef('treble');
        bsv.addClef('bass');
        if (score.keyFifths) {
          t.addKeySignature(key);
          bsv.addKeySignature(key);
        }
        if (si === 0) {
          const ts = `${score.timeSignature[0]}/${score.timeSignature[1]}`;
          t.addTimeSignature(ts);
          bsv.addTimeSignature(ts);
        }
      }
      const final = opts.isLast && bi === built.length - 1;
      if (final) {
        t.setEndBarType(BarlineType.END);
        bsv.setEndBarType(BarlineType.END);
      }
      const startX = Math.max(t.getNoteStartX(), bsv.getNoteStartX());
      t.setNoteStartX(startX);
      bsv.setNoteStartX(startX);
      t.setContext(ctx).draw();
      bsv.setContext(ctx).draw();
      if (k === 0) {
        new StaveConnector(t, bsv).setType('brace').setContext(ctx).draw();
        new StaveConnector(t, bsv).setType('singleLeft').setContext(ctx).draw();
      }
      new StaveConnector(t, bsv).setType(final ? 'boldDoubleRight' : 'singleRight').setContext(ctx).draw();

      // bar number above the treble staff
      const num = document.createElementNS(SVG_NS, 'text');
      num.setAttribute('class', 'ps-barnum');
      num.setAttribute('x', String(k === 0 ? x + 2 : x + 4));
      num.setAttribute('y', String(trebleTop - 14 - Math.max(0, (trMax - TREBLE_TOP) * 5)));
      num.textContent = String(b.m.number);
      labels.appendChild(num);

      try {
        b.fmt.format([b.tv, b.bv], Math.max(20, t.getNoteEndX() - startX - 12));
        b.tv.draw(ctx, t);
        b.bv.draw(ctx, bsv);
        for (const beam of b.beams) beam.setContext(ctx).draw();
      } catch (err) {
        console.warn('[sheet] could not draw bar', b.m.number, err);
      }
      x += w;
      b.beams.forEach((beam, i) => {
        try {
          ext(beam.getSVGElement(), b.beamStaff[i] === 'treble' ? tExt : bExt);
        } catch {
          /* not drawn */
        }
      });

      for (const staff of ['treble', 'bass'] as const) {
        for (const ev of b.m[staff]) {
          const sn = b.notes.get(ev.id)!;
          noteSystem.set(ev.id, si);
          let el: Element | null = null;
          let hx = x;
          try {
            el = sn.getSVGElement() ?? null;
            hx = sn.getNoteHeadBeginX() + (sn.getNoteHeadEndX() - sn.getNoteHeadBeginX()) / 2;
          } catch {
            /* not drawn */
          }
          if (el) {
            // VexFlow's own bounding box of the note (stem + flag) is drawn as an invisible
            // <rect>; the glyph <text> boxes are useless here (they span the font's whole ascent)
            ext(el.querySelector(':scope > rect'), staff === 'treble' ? tExt : bExt);
            el.classList.add('ps-ev', ev.notes.length ? `ps-${ev.notes[0].hand}` : 'ps-rest');
            const inside = ev.notes.length
              ? ev.notes.some((n) => opts.inside.has(n.index))
              : ev.start >= opts.window[0] - 0.01 && ev.start < opts.window[1] - 0.01;
            if (!inside) el.classList.add('ps-out');
          }
          events.set(ev.id, { ev, x: hx, system: si, el });
          if (!ev.notes.length) continue;
          const ys = sn.getYs();
          const headEls = el ? [...el.querySelectorAll('.vf-notehead')] : [];
          ev.notes.forEach((n, i) => {
            heads.push({
              x: hx,
              y: ys[i] ?? (staff === 'treble' ? trebleTop : bassTop),
              pitch: n.pitch,
              index: n.index,
              eventId: ev.id,
              staff,
              tied: ev.continued,
              el: headEls[i] ?? null,
              label: null,
            });
          });
        }
      }
    });

    // ties are drawn after every system exists (see below)
    sysBoxes.push({ top: trebleTop - 2 * LINE, bottom: bassTop + STAFF_H + 2 * LINE });

    // note names: one row per chord tone under each staff, highest tone first, clear of stems/beams
    const tNamesY = Math.max(trebleTop + STAFF_H + namesTOffset, tExt.max + 14);
    const bNamesY = Math.max(bassTop + STAFF_H + namesBOffset, bExt.max + 14);
    let bottom = Math.max(bassTop + STAFF_H + Math.max(30, below + 16), bExt.max + 10);
    if (opts.names) {
      bottom = Math.max(bottom, bNamesY + namesB - rowH + 4);
      const rows: Array<[Staff, number]> = [
        ['treble', tNamesY],
        ['bass', bNamesY],
      ];
      for (const [staff, baseY] of rows) {
        const sysHeads = heads.filter((h) => h.staff === staff && !h.tied && noteSystem.get(h.eventId) === si);
        const byEvent = new Map<string, DrawnHead[]>();
        for (const h of sysHeads) (byEvent.get(h.eventId) ?? byEvent.set(h.eventId, []).get(h.eventId)!).push(h);
        for (const hs of byEvent.values()) {
          hs.sort((a, b) => b.pitch - a.pitch)
            .slice(0, 4)
            .forEach((h, r) => {
              const ev = events.get(h.eventId)!.ev;
              const n = ev.notes.find((x) => x.index === h.index)!;
              const t = document.createElementNS(SVG_NS, 'text');
              t.setAttribute('class', `ps-name ps-${n.hand}`);
              t.setAttribute('x', String(h.x));
              t.setAttribute('y', String(baseY + r * rowH));
              t.setAttribute('text-anchor', 'middle');
              t.textContent = spelledName(n, opts.nameSystem);
              if (!opts.inside.has(h.index)) t.classList.add('ps-out');
              labels.appendChild(t);
              h.label = t;
            });
        }
      }
    }
    top = bottom + 6;
  });

  // ties (also across lines and into bars outside the fragment, drawn as half ties)
  for (const staff of ['treble', 'bass'] as const) {
    const evs = measures.flatMap((m) => m[staff]);
    const noteOf = (id: string) => built.find((b) => b.notes.has(id))?.notes.get(id) ?? null;
    evs.forEach((ev, i) => {
      if (!ev.notes.length) return;
      const idx = ev.notes.map((_, k) => k);
      const tie = (first: StaveNote | null, last: StaveNote | null) => {
        try {
          new StaveTie({ firstNote: first, lastNote: last, firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw();
        } catch (err) {
          console.warn('[sheet] tie', err);
        }
      };
      if (ev.continued && i === 0) tie(null, noteOf(ev.id));
      if (!ev.tieToNext) return;
      const next = evs[i + 1];
      if (!next) {
        tie(noteOf(ev.id), null);
        return;
      }
      if (noteSystem.get(ev.id) === noteSystem.get(next.id)) tie(noteOf(ev.id), noteOf(next.id));
      else {
        tie(noteOf(ev.id), null);
        tie(null, noteOf(next.id));
      }
    });
  }

  svg.appendChild(labels);
  const H = Math.max(top, 40);
  svg.setAttribute('viewBox', `0 0 ${L} ${H}`);
  svg.setAttribute('width', String(opts.width));
  svg.setAttribute('height', String(H * zoom));
  svg.style.width = `${opts.width}px`;
  svg.style.height = `${H * zoom}px`;
  svg.removeAttribute('pointer-events');
  svg.setAttribute('role', 'img');

  return { svg, width: L, height: H, zoom, heads, events, systems: sysBoxes, cursor };
}

/** Logical (SVG) coordinates of a pointer event. */
export function toLogical(d: Drawn, clientX: number, clientY: number): { x: number; y: number } {
  const r = d.svg.getBoundingClientRect();
  return { x: ((clientX - r.left) * d.width) / r.width, y: ((clientY - r.top) * d.height) / r.height };
}

/** The note head nearest to a point, within `radius` logical px (vertical distance counts less). */
export function nearestHead(d: Drawn, x: number, y: number, radius = 30): DrawnHead | null {
  let best: DrawnHead | null = null;
  let bestD = Infinity;
  for (const h of d.heads) {
    const dd = Math.hypot(h.x - x, (h.y - y) * 0.6);
    if (dd < bestD) {
      bestD = dd;
      best = h;
    }
  }
  return bestD <= radius ? best : null;
}
