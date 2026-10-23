import { pitchName, type NoteNameSystem } from '@piano-steps/core';
import { timeToY, type KeyRect } from './geometry.ts';
import { period, type Bar, type Span } from './timeline.ts';

/** Theme colours resolved from the CSS variables (a canvas cannot use `var(--…)` directly). */
export interface LaneColors {
  lane: string;
  laneBlack: string;
  grid: string;
  handR: string;
  handL: string;
  accent: string;
  onBar: string;
  strong: string;
  mut: string;
}

export function readColors(el: Element): LaneColors {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    lane: v('--panel-2', '#f0eee6'),
    laneBlack: v('--bd', '#d1cfc5'),
    grid: v('--bd', '#d1cfc5'),
    handR: v('--hand-r', '#d97757'),
    handL: v('--hand-l', '#6a8caf'),
    accent: v('--accent', '#d97757'),
    onBar: v('--accent-fg', '#ffffff'),
    strong: v('--strong', '#141413'),
    mut: v('--mut', '#87867f'),
  };
}

export interface LaneFrame {
  width: number; // CSS px
  height: number; // CSS px
  dpr: number;
  keys: ReadonlyMap<number, KeyRect>;
  bars: readonly Bar[];
  now: number;
  lookAhead: number;
  span: Span;
  loop: boolean;
  colors: LaneColors;
  noteNames: NoteNameSystem;
  /** Onset (unwrapped time) of the step the user must play now / next — its bars get an outline. */
  focusTime?: number;
}

/** Where a bar is drawn, in CSS px (also used for hit-testing taps). */
export function barRect(b: Bar, f: Pick<LaneFrame, 'width' | 'height' | 'keys' | 'now' | 'lookAhead'>) {
  const k = f.keys.get(b.note.pitch);
  if (!k) return null;
  const inset = k.black ? 1 : 2;
  const x = k.x * f.width + inset;
  const w = Math.max(2, k.w * f.width - inset * 2);
  const top = timeToY(b.end, f.now, f.lookAhead, f.height);
  const bottom = Math.min(f.height, timeToY(b.start, f.now, f.lookAhead, f.height));
  if (bottom <= 0 || top >= f.height || bottom - top < 0.5) return null;
  return { x, w, top: Math.max(-8, top), bottom, black: k.black };
}

/** Paint one frame of the falling lane. */
export function drawLane(ctx: CanvasRenderingContext2D, f: LaneFrame) {
  const { width: W, height: H, colors: c } = f;
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // background + key columns (black-key columns shaded, a line at every white-key boundary, stronger at C)
  ctx.fillStyle = c.lane;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = c.laneBlack;
  for (const k of f.keys.values()) if (k.black) ctx.fillRect(k.x * W, 0, k.w * W, H);
  ctx.globalAlpha = 1;
  for (const k of f.keys.values()) {
    if (k.black) continue;
    const isC = k.pitch % 12 === 0;
    ctx.globalAlpha = isC ? 0.9 : 0.45;
    ctx.fillStyle = c.grid;
    ctx.fillRect(Math.round(k.x * W) - (isC ? 1 : 0.5), 0, isC ? 2 : 1, H);
  }
  ctx.globalAlpha = 1;

  // loop seam: where the fragment starts over
  if (f.loop) {
    const p = period(f.span);
    if (p > 0.05) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = c.mut;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      const first = Math.ceil((f.now - f.span.start) / p);
      for (let k = Math.max(1, first); ; k++) {
        const t = f.span.start + k * p;
        if (t > f.now + f.lookAhead) break;
        const y = Math.round(timeToY(t, f.now, f.lookAhead, H)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // bars: dimmed hand first, then white-key bars, then black-key bars on top
  const order = [...f.bars].sort((a, b) => Number(a.active) - Number(b.active) || blackness(f, a) - blackness(f, b));
  for (const b of order) {
    const r = barRect(b, f);
    if (!r) continue;
    const colour = b.note.hand === 'L' ? c.handL : c.handR;
    const h = r.bottom - r.top;
    ctx.globalAlpha = b.active ? 1 : 0.22;
    ctx.fillStyle = colour;
    roundRect(ctx, r.x, r.top, r.w, h, Math.min(6, r.w / 3, h / 2));
    ctx.fill();
    if (r.black) {
      // a shade darker on black keys, like the keys themselves
      ctx.fillStyle = 'rgb(0 0 0 / 0.2)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.lane;
      ctx.stroke();
    }
    if (b.active && f.focusTime !== undefined && Math.abs(b.start - f.focusTime) < 0.05) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = c.strong;
      ctx.stroke();
    }
    if (b.active) drawLabel(ctx, f, b, r, h);
    ctx.globalAlpha = 1;
  }

  // now-line with a soft glow above it
  const g = ctx.createLinearGradient(0, H - 28, 0, H);
  g.addColorStop(0, 'rgb(0 0 0 / 0)');
  g.addColorStop(1, withAlpha(c.accent, 0.22));
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 28, W, 28);
  ctx.fillStyle = c.accent;
  ctx.fillRect(0, H - 4, W, 4);
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  f: LaneFrame,
  b: Bar,
  r: { x: number; w: number; bottom: number },
  h: number,
) {
  const fs = Math.round(Math.max(10, Math.min(15, r.w * 0.36)));
  if (h < fs + 6) return;
  ctx.font = `700 ${fs}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  let name = pitchName(b.note.pitch, f.noteNames);
  if (ctx.measureText(name).width > r.w - 4) name = pitchName(b.note.pitch, f.noteNames, { withOctave: false });
  if (ctx.measureText(name).width > r.w - 2) return;
  ctx.fillStyle = f.colors.onBar;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(name, r.x + r.w / 2, Math.min(r.bottom, f.height - 4) - 4);
}

function blackness(f: LaneFrame, b: Bar): number {
  return f.keys.get(b.note.pitch)?.black ? 1 : 0;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, Math.max(0, r));
  else ctx.rect(x, y, w, h);
}

/** `#rrggbb` → `rgb(r g b / a)`; anything else is returned as is. */
export function withAlpha(colour: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return colour;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
}
