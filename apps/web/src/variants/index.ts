import { lazy } from 'react';
import type { VariantDef } from '../variant.ts';

/**
 * The practice UIs being compared. Each one is built on its own branch inside its own
 * folder; switching between them is a tab in the app (and `?ui=<id>` in the URL).
 */
export const VARIANTS: VariantDef[] = [
  {
    id: 'falling',
    name: { uk: 'Падаючі ноти', en: 'Falling notes' },
    blurb: { uk: 'Ноти падають на клавіші, як у Synthesia', en: 'Notes fall onto the keys, Synthesia-style' },
    component: lazy(() => import('./falling/index.tsx')),
  },
  {
    id: 'cards',
    name: { uk: 'Картки', en: 'Cards' },
    blurb: { uk: 'Крок за кроком: ця клавіша, потім ці дві разом', en: 'Step by step: this key, then these two together' },
    component: lazy(() => import('./cards/index.tsx')),
  },
  {
    id: 'sheet',
    name: { uk: 'Ноти + клавіші', en: 'Sheet + keys' },
    blurb: { uk: 'Нотний запис синхронно з клавіатурою', en: 'Notation in sync with the keyboard' },
    component: lazy(() => import('./sheet/index.tsx')),
  },
];
