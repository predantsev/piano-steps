import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { DevState } from '../apps/web/src/devtools/types.ts';

/**
 * Shared e2e setup:
 * - every test fails on a console error or an uncaught page error (`consoleErrors`, auto);
 * - the piano samples (tonejs.github.io) are answered with a short silent WAV, so tests need no
 *   internet and audio decoding still succeeds;
 * - helpers to open the app, read `window.pianoSteps.getState()` and tap-or-click.
 *
 * Selectors only use shell-owned DOM (top bar, tabs, `.pk [data-pitch]` of ui/PianoKeyboard,
 * the file input, dialogs) — never a variant's own markup, which is being rebuilt in parallel.
 */

/** Console errors that are not the app's fault. Keep this list short and explain each entry. */
const IGNORED_CONSOLE_ERRORS: RegExp[] = [];

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !IGNORED_CONSOLE_ERRORS.some((re) => re.test(m.text()))) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.route('https://tonejs.github.io/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'audio/wav',
          headers: { 'access-control-allow-origin': '*' },
          body: SILENT_WAV,
        }),
      );
      await use(errors);
      expect(errors, 'console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Open the app (optionally with `?lesson=…&ui=…`) and wait until a lesson is on screen.
 * Without `lesson=` it opens a demo lesson: parallel tests share one DB and create/delete their own
 * lessons, so a lesson the app picked on its own could be deleted under it (a 404 console error).
 */
export async function openApp(page: Page, query = ''): Promise<DevState> {
  const params = new URLSearchParams(query);
  if (!params.has('lesson')) params.set('lesson', 'ode-to-joy');
  await page.goto(`/?${params}`);
  await page.waitForFunction(() => window.pianoSteps?.getState().ready === true);
  return state(page);
}

export const state = (page: Page): Promise<DevState> => page.evaluate(() => window.pianoSteps!.getState());

/** A finger on touch devices, the mouse elsewhere. */
export async function tapOrClick(target: Locator, hasTouch: boolean, position?: { x: number; y: number }) {
  if (hasTouch) await target.tap(position ? { position } : {});
  else await target.click(position ? { position } : {});
}

/** 50 ms of 16-bit mono silence — a valid audio file for both Chromium and WebKit decoders. */
const SILENT_WAV = (() => {
  const rate = 22050;
  const bytes = Math.round(rate * 0.05) * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  return b;
})();
