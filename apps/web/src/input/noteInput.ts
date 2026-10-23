/**
 * One stream of "the user pressed / released key X", whatever the source:
 * - 'screen'   — the on-screen keyboard (touch / mouse)
 * - 'keyboard' — the computer keyboard (A W S E D F T G Y H U J K = C4…C5; Z / X shift octave)
 * - 'sim'      — injected by tests / agents (the dev automation API)
 * - 'mic'      — reserved: pitch detection from a microphone (idea, not built)
 *
 * The user's acoustic piano is not connected to anything, so the default flow is
 * "look → play on the real piano → tap Next". Input is optional, for practising on screen.
 */

export type NoteSource = 'screen' | 'keyboard' | 'sim' | 'mic';
export interface NoteEvent {
  type: 'on' | 'off';
  pitch: number;
  source: NoteSource;
  at: number; // performance.now()
}
type Listener = (e: NoteEvent) => void;

const QWERTY: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16,
};

export class NoteInput {
  readonly held = new Set<number>();
  private listeners = new Set<Listener>();
  private octave = 4;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(type: 'on' | 'off', pitch: number, source: NoteSource) {
    if (type === 'on') {
      if (this.held.has(pitch) && source !== 'sim') return;
      this.held.add(pitch);
    } else this.held.delete(pitch);
    const e: NoteEvent = { type, pitch, source, at: performance.now() };
    for (const l of this.listeners) l(e);
  }

  /** Listen to the computer keyboard. Returns a detach function. */
  attachComputerKeyboard(target: Window = window): () => void {
    const isTyping = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || isTyping(ev)) return;
      const k = ev.key.toLowerCase();
      if (k === 'z') this.octave = Math.max(1, this.octave - 1);
      else if (k === 'x') this.octave = Math.min(7, this.octave + 1);
      else if (k in QWERTY) this.emit('on', (this.octave + 1) * 12 + QWERTY[k], 'keyboard');
    };
    const up = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      if (k in QWERTY) this.emit('off', (this.octave + 1) * 12 + QWERTY[k], 'keyboard');
    };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    };
  }
}
