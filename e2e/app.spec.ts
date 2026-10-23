import { readFileSync } from 'node:fs';
import { expect, openApp, state, tapOrClick, test } from './fixtures.ts';

/** Smoke flows of the shell, on iPad (WebKit, touch) and desktop Chromium. */

const DEMO_SLUGS = ['fur-elise-opening', 'ode-to-joy', 'twinkle-twinkle'];
/** Both projects (and --repeat-each copies) share one in-memory DB: never reuse a slug or message. */
const unique = () => Math.random().toString(36).slice(2, 8);
const noSidewaysScroll = () => document.documentElement.scrollWidth <= window.innerWidth;

test('loads with the demo lessons', async ({ page }) => {
  const s = await openApp(page);
  const options = await page.locator('header select option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(options).toEqual(expect.arrayContaining(DEMO_SLUGS));
  expect(s.offline).toBe(false);
  expect(s.lesson).not.toBeNull();
  expect(await page.evaluate(noSidewaysScroll)).toBe(true);
});

test('switches lesson from the top bar (and the picker follows the automation API)', async ({ page }) => {
  await openApp(page, '?lesson=ode-to-joy');
  await page.locator('header select').selectOption('twinkle-twinkle');
  await expect.poll(async () => (await state(page)).lesson?.slug).toBe('twinkle-twinkle');
  await expect(page).toHaveURL(/lesson=twinkle-twinkle/);

  await page.evaluate(() => window.pianoSteps!.selectLesson('fur-elise-opening'));
  await expect(page.locator('header select')).toHaveValue('fur-elise-opening');
});

test('every variant tab renders without console errors', async ({ page, hasTouch, consoleErrors }) => {
  const { variants } = await openApp(page, '?lesson=ode-to-joy');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(variants.length);
  for (let i = 0; i < variants.length; i++) {
    await tapOrClick(tabs.nth(i), hasTouch);
    await expect(tabs.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => {
      const s = await state(page);
      return s.variant === variants[i] && s.ready;
    }).toBe(true);
    await expect(page.locator('main.stage')).not.toBeEmpty();
    expect(await page.evaluate(noSidewaysScroll), `${variants[i]}: no sideways scroll`).toBe(true);
    expect(consoleErrors, `${variants[i]}: console errors`).toEqual([]);
  }
});

test('tapping an on-screen key registers it, and a held key is lit', async ({ page, hasTouch }) => {
  await openApp(page, '?lesson=ode-to-joy');
  const key = page.locator('.pk [data-pitch="60"]').first(); // C4, a white key
  await expect(key).toBeVisible();
  const box = (await key.boundingBox())!;
  const at = { x: box.width / 2, y: box.height * 0.85 }; // low on the white key, clear of the black keys

  // A real tap (touch on the iPad) goes through the keyboard: on, then off, from the screen.
  await tapOrClick(key, hasTouch, at);
  await expect
    .poll(async () => (await state(page)).recentInput.filter((e) => e.pitch === 60 && e.source === 'screen').map((e) => e.type))
    .toEqual(['on', 'off']);

  // Held down, the key is lit. (Playwright has no touch-and-hold, so the hold uses the mouse.)
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await expect(key).toHaveClass(/\bpk-(hint|ok|bad|next|hold|R|L)\b/);
  expect((await state(page)).heldKeys).toEqual([60]);
  expect((await state(page)).litKeys.map((k) => k.pitch)).toContain(60);
  await page.mouse.up();
  // Released: heldKeys is the truth. (litKeys may keep a view's own cue on it, e.g. the sheet's probe.)
  await expect.poll(async () => (await state(page)).heldKeys).toEqual([]);
});

test('feedback dialog posts and the feedback is in GET /api/feedback', async ({ page, hasTouch }, testInfo) => {
  const { fragment } = await openApp(page, '?lesson=ode-to-joy');
  const message = `e2e ${testInfo.project.name} ${unique()}: bar 2 sounds lower than the video`;

  await tapOrClick(page.getByRole('button', { name: /Sounds wrong/ }), hasTouch);
  await page.getByRole('textbox').fill(message);
  await tapOrClick(page.getByRole('button', { name: 'Send', exact: true }), hasTouch);
  await expect(page.getByText(/^✓ Sent/)).toBeVisible();

  const res = await page.request.get('/api/feedback?lesson=ode-to-joy&status=open');
  expect(res.ok()).toBe(true);
  const { feedback } = (await res.json()) as { feedback: { message: string; lessonSlug: string; fragmentPosition?: number; status: string }[] };
  const item = feedback.find((f) => f.message === message);
  expect(item).toMatchObject({ lessonSlug: 'ode-to-joy', status: 'open' });
  expect(item?.fragmentPosition).toBe(fragment?.position);
});

test('imports a lesson JSON through the file input', async ({ page }, testInfo) => {
  await openApp(page);
  const slug = `e2e-import-${testInfo.project.name}-${unique()}`;
  const lesson = {
    slug,
    title: `E2E import (${testInfo.project.name})`,
    notes: [
      { pitch: 60, start: 0, duration: 0.5, hand: 'R' },
      { pitch: 64, start: 0.5, duration: 0.5, hand: 'R' },
      { pitch: 48, start: 0, duration: 1, hand: 'L' },
    ],
  };
  await page.locator('input[type=file]').setInputFiles({
    name: `${slug}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(lesson)),
  });
  await expect.poll(async () => (await state(page)).lesson?.slug).toBe(slug);
  await expect(page.locator('header select')).toHaveValue(slug);
  await expect(page.locator(`header select option[value="${slug}"]`)).toHaveText(lesson.title);
  expect((await page.request.delete(`/api/lessons/${slug}`)).status()).toBe(204);
});

test('imports a MusicXML score through the file input', async ({ page }, testInfo) => {
  await openApp(page);
  const title = `E2E MusicXML ${testInfo.project.name} ${unique()}`;
  const xml = readFileSync(new URL('../packages/core/src/fixtures/two-hands.musicxml', import.meta.url), 'utf8').replace(
    '<work-title>Test Piece</work-title>',
    `<work-title>${title}</work-title>`,
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'score.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(xml),
  });
  await expect.poll(async () => (await state(page)).lesson?.title).toBe(title);
  const s = await state(page);
  expect(s.lesson).toMatchObject({ noteCount: 12 });
  expect((await page.request.delete(`/api/lessons/${s.lesson!.slug}`)).status()).toBe(204);
});

test('asks for the API token when the server requires one, and sends it', async ({ page, hasTouch }) => {
  // This server runs without API_TOKEN; pretend it has one, then check the header the app sends.
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, db: 'pglite', auth: true } }));
  await openApp(page, '?lesson=twinkle-twinkle');
  await tapOrClick(page.getByRole('button', { name: 'Settings' }), hasTouch);
  const field = page.getByLabel('API token');
  await expect(field).toBeVisible();
  await field.fill('e2e-secret');
  await tapOrClick(page.getByRole('button', { name: 'Close' }), hasTouch);

  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/feedback'));
  await tapOrClick(page.getByRole('button', { name: /Sounds wrong/ }), hasTouch);
  await page.getByRole('textbox').fill('token check');
  await tapOrClick(page.getByRole('button', { name: 'Send', exact: true }), hasTouch);
  expect((await sent).headers()['authorization']).toBe('Bearer e2e-secret');
  expect(await page.evaluate(() => localStorage.getItem('piano-steps-api-token'))).toBe('e2e-secret');
});
