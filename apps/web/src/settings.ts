import type { NoteNameSystem } from '@piano-steps/core';
import { useCallback, useEffect, useState } from 'react';

export type Lang = 'uk' | 'en';
export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  lang: Lang;
  noteNames: NoteNameSystem;
  /** Note names printed on keys. */
  keyLabels: 'all' | 'c' | 'none';
  /** Default practice speed, 0.25…1. */
  speed: number;
}

const KEY = 'piano-steps-settings';
const THEME_KEY = 'piano-steps-theme';

const defaults = (): Settings => ({
  lang: typeof navigator !== 'undefined' && /^(uk|ru)/i.test(navigator.language) ? 'uk' : 'en',
  noteNames: 'letter',
  keyLabels: 'c',
  speed: 1,
});

function read(): Settings {
  try {
    return { ...defaults(), ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return defaults();
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(read);
  const update = useCallback((patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }, []);
  useEffect(() => {
    document.documentElement.lang = s.lang;
  }, [s.lang]);
  return [s, update];
}

/** Tri-state theme: 'system' removes data-theme so the OS preference applies live. */
export function useTheme(): [ThemePref, () => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
  }, [pref]);
  const cycle = useCallback(() => {
    setPref((p) => {
      const next: ThemePref = p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [pref, cycle];
}
