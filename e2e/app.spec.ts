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

test('a token with invisible or non-Latin characters never breaks the app', async ({ page, hasTouch }) => {
  // A token saved earlier with a Cyrillic letter (it cannot go into an HTTP header): the app still loads
  // from the API — not offline — and the field stays reachable in Settings.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('piano-steps-api-token', 'токен');
      sessionStorage.setItem('seeded', '1');
    }
  });
  const s = await openApp(page, '?lesson=twinkle-twinkle');
  expect(s.offline).toBe(false);
  await tapOrClick(page.getByRole('button', { name: 'Settings' }), hasTouch);
  const field = page.getByLabel('API token');
  // No server token here and the stored one is unusable → no field; typing a bad one is refused visibly.
  await expect(field).toHaveCount(0);
  await tapOrClick(page.getByRole('button', { name: 'Close' }), hasTouch);

  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, db: 'pglite', auth: true } }));
  await page.reload();
  await page.waitForFunction(() => window.pianoSteps?.getState().ready === true);
  await tapOrClick(page.getByRole('button', { name: 'Settings' }), hasTouch);
  await page.getByLabel('API token').fill('токен');
  await expect(page.getByRole('alert')).toContainText('Latin letters');
  // A pasted zero-width space is dropped, the rest is sent.
  await page.getByLabel('API token').fill('e2e-secret\u200b ');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await tapOrClick(page.getByRole('button', { name: 'Close' }), hasTouch);
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/feedback'));
  await tapOrClick(page.getByRole('button', { name: /Sounds wrong/ }), hasTouch);
  await page.getByRole('textbox').fill('token check');
  await tapOrClick(page.getByRole('button', { name: 'Send', exact: true }), hasTouch);
  expect((await sent).headers()['authorization']).toBe('Bearer e2e-secret');
  // Reads never carry the token.
  const get = page.waitForRequest((r) => r.method() === 'GET' && r.url().includes('/api/lessons'));
  await page.evaluate(() => window.pianoSteps!.listLessons());
  expect((await get).headers()['authorization']).toBeUndefined();
});

test('the guide opens from the top bar, fits the screen and closes', async ({ page, hasTouch }) => {
  await openApp(page, '?lesson=ode-to-joy&ui=falling');
  for (const name of ['How to use it', 'Settings']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box!.width, `${name} is finger-sized`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${name} is finger-sized`).toBeGreaterThanOrEqual(44);
  }
  await tapOrClick(page.getByRole('button', { name: 'How to use it', exact: true }), hasTouch);
  const dialog = page.getByRole('dialog', { name: 'How to use it' });
  await expect(dialog).toBeVisible();
  const feedback = dialog.locator('[data-help="feedback"]');
  await tapOrClick(feedback.locator('summary'), hasTouch);
  await expect(feedback).toContainText('An agent fixes it');
  const box = await dialog.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await tapOrClick(dialog.getByRole('button', { name: 'Close' }), hasTouch);
  await expect(dialog).toBeHidden();
});

test('the falling view orders hands as on the keyboard: left before right', async ({ page }) => {
  await openApp(page, '?lesson=ode-to-joy&ui=falling');
  const hands = page.getByRole('group', { name: 'Hands' }).getByRole('button');
  await expect(hands).toHaveText(['Both', 'Left', 'Right']);
});

test('tapping a falling note opens its menu and saves a report about that exact note', async ({ page, hasTouch }) => {
  await openApp(page, '?lesson=twinkle-twinkle&ui=falling');
  const canvas = page.locator('.fl-lane canvas');
  await expect(canvas).toBeVisible();
  // Find a hand-coloured bar pixel (green = right, blue = left); the lane is grey, the now-line orange.
  const hit = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const { width, height } = c;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = height - 4; y > 0; y -= 4)
      for (let x = 2; x < width; x += 4) {
        const i = (y * width + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (g > r + 50 || b > r + 50) {
          const box = c.getBoundingClientRect();
          return { x: (x / width) * box.width, y: (y / height) * box.height };
        }
      }
    return null;
  });
  expect(hit, 'a bar is drawn').not.toBeNull();
  if (hasTouch) await canvas.tap({ position: hit! });
  else await canvas.click({ position: hit! });

  const menu = page.locator('.fl-notemenu');
  await expect(menu).toBeVisible();
  await tapOrClick(menu.getByRole('button', { name: 'Should be lower' }), hasTouch);
  const message = `e2e ${unique()}`;
  await menu.locator('textarea').fill(message);
  await tapOrClick(menu.getByRole('button', { name: 'Save report' }), hasTouch);
  await expect(menu).toContainText('Saved');

  const all = await page.evaluate(async () => (await (await fetch('/api/feedback?lesson=twinkle-twinkle')).json()).feedback);
  const mine = all.find((f: { message: string }) => f.message === message);
  expect(mine).toMatchObject({ kind: 'lower', status: 'open' });
  expect(mine.noteId).toMatch(/^n/);
  expect(mine.note.pitch).toBeGreaterThan(0);
  await expect(menu).toBeHidden();
});

test('a note switched off from its menu: stored, counted on the fragment, switched back on (#52)', async ({ page, hasTouch }, testInfo) => {
  const slug = testInfo.project.name.includes('ipad') ? 'fur-elise-opening' : 'ode-to-joy'; // projects run in parallel
  const muted = async (): Promise<string[]> =>
    page.evaluate(async (s) => (await (await fetch(`/api/lessons/${s}/muted-notes`)).json()).noteIds, slug);
  await openApp(page, `?lesson=${slug}&ui=falling`);
  const before = await muted();
  const canvas = page.locator('.fl-lane canvas');
  await expect(canvas).toBeVisible();
  const hit = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const { width, height } = c;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = height - 4; y > 0; y -= 4)
      for (let x = 2; x < width; x += 4) {
        const i = (y * width + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (g > r + 50 || b > r + 50) {
          const box = c.getBoundingClientRect();
          return { x: (x / width) * box.width, y: (y / height) * box.height };
        }
      }
    return null;
  });
  expect(hit, 'a bar is drawn').not.toBeNull();
  const tapBar = () => (hasTouch ? canvas.tap({ position: hit! }) : canvas.click({ position: hit! }));

  await tapBar();
  const menu = page.locator('.fl-notemenu');
  await tapOrClick(menu.getByRole('button', { name: /Switch this note off/ }), hasTouch);
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await muted()).length).toBe(before.length + 1);
  const id = (await muted()).find((x) => !before.includes(x))!;
  await expect(page.locator('.fl-chip[data-fragment="0"] .fl-mutedcount')).toBeVisible();

  await tapBar(); // the ghost is still there, in the same place
  await tapOrClick(menu.getByRole('button', { name: /Switch it back on/ }), hasTouch);
  await expect.poll(async () => (await muted()).includes(id)).toBe(false);
});

test('a fragment note: hold the number, write, mark "come back later", see it on the number and in the list', async ({ page, hasTouch }) => {
  await openApp(page, '?lesson=fur-elise-opening&ui=falling');
  const chip = page.locator('.fl-chip[data-fragment="1"]');
  await expect(chip).toBeVisible();
  // Hold ~0.5 s (a long press on the iPad, the same pointer events with a mouse).
  await chip.dispatchEvent('pointerdown', { pointerType: hasTouch ? 'touch' : 'mouse', isPrimary: true });
  await page.waitForTimeout(650);
  await chip.dispatchEvent('pointerup', { pointerType: hasTouch ? 'touch' : 'mouse', isPrimary: true });
  await chip.dispatchEvent('click');

  const menu = page.locator('.fl-fragmenu');
  await expect(menu).toBeVisible();
  const text = `e2e ${unique()}`;
  await menu.locator('textarea').fill(text);
  await tapOrClick(menu.getByRole('button', { name: 'Come back later' }), hasTouch);
  await tapOrClick(menu.getByRole('button', { name: 'Too hard — split it' }), hasTouch);
  await tapOrClick(menu.getByRole('button', { name: 'Save' }), hasTouch);
  await expect(menu).toBeHidden();
  await expect(chip).toHaveAttribute('aria-label', /has a note/);
  await expect(chip).toHaveAttribute('aria-pressed', 'false'); // holding did not switch the fragment

  const stored = await page.evaluate(async () => (await (await fetch('/api/lessons/fur-elise-opening/fragment-notes')).json()).notes);
  expect(stored).toEqual([expect.objectContaining({ fragmentPosition: 1, text, later: true, tags: ['split'] })]);

  await tapOrClick(page.getByRole('button', { name: /Sounds wrong/ }), hasTouch);
  await tapOrClick(page.getByRole('tab', { name: /Notes on fragments/ }), hasTouch);
  const item = page.locator('.frag-notes .report[data-fragment="1"]');
  await expect(item).toContainText(text);
  await tapOrClick(item.getByRole('button', { name: 'Done' }), hasTouch);
  await expect(item).toBeHidden();
  await expect(chip).not.toHaveAttribute('aria-label', /has a note/);
});

test('the falling bar: Space plays / pauses, ← / → and a swipe move 3 s, ⏮ goes back to the start, ‹ › switch fragments', async ({ page, hasTouch }) => {
  await openApp(page, '?lesson=twinkle-twinkle&ui=falling');
  await tapOrClick(page.locator('.brand'), hasTouch); // a real gesture: audio may start
  const main = page.locator('.fl-primary');
  const player = async () => (await state(page)).player;
  await expect(main).toContainText('Play');

  await tapOrClick(main, hasTouch);
  await expect(main).toContainText('Pause');
  await expect.poll(async () => (await player()).time, { timeout: 8000 }).toBeGreaterThan(1.6);
  await page.keyboard.press('Space');
  await expect(main).toContainText('Play'); // paused
  await page.keyboard.press('Space'); // resume from where it paused — not from the start (which has a lead-in at 0)
  await expect(main).toContainText('Pause');
  await expect.poll(async () => (await player()).time, { timeout: 600 }).toBeGreaterThan(1.4);

  // ← / → = 3 s back / forward inside the fragment, and it keeps playing (#46).
  await page.keyboard.press('ArrowLeft'); // ~1.5 s − 3 s → the fragment start
  await expect.poll(async () => (await player()).time, { timeout: 2000 }).toBeLessThan(1);
  await expect(main).toContainText('Pause');
  const before = (await player()).time;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await player()).from, { timeout: 2000 }).toBeGreaterThan(before + 2.5);
  await expect(main).toContainText('Pause');
  await expect(page.locator('.fl-chip[data-fragment="0"]')).toHaveAttribute('aria-pressed', 'true'); // same fragment

  // A sideways swipe on the lane does the same with a finger (#48): left = back, right = forward.
  const lane = await page.locator('.fl-lane canvas').boundingBox();
  const swipe = async (from: number, to: number) => {
    const y = lane!.y + lane!.height * 0.4;
    await page.mouse.move(lane!.x + lane!.width * from, y);
    await page.mouse.down();
    await page.mouse.move(lane!.x + lane!.width * to, y, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(0.7, 0.3); // left → back to the fragment start
  await expect.poll(async () => (await player()).time, { timeout: 2000 }).toBeLessThan(1);
  const atStart = (await player()).time;
  await swipe(0.3, 0.7); // right → 3 s on
  await expect.poll(async () => (await player()).from, { timeout: 2000 }).toBeGreaterThan(atStart + 2.5);
  await expect(main).toContainText('Pause');
  await expect(page.locator('.fl-menu-backdrop')).toHaveCount(0); // a swipe never opens the note menu

  await page.keyboard.press('Shift+Space'); // back to the start (with the lead-in), keeps playing
  await expect(page.locator('.fl-status')).toContainText('Get ready');
  await expect.poll(async () => (await player()).time, { timeout: 4000 }).toBeLessThan(1);
  await expect(main).toContainText('Pause');
  await tapOrClick(main, hasTouch);

  const chip = (i: number) => page.locator(`.fl-chip[data-fragment="${i}"]`);
  await expect(page.locator('.fl-prev')).toBeDisabled();
  await tapOrClick(page.locator('.fl-next'), hasTouch);
  await expect(chip(1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+ArrowLeft'); // Shift + arrow = just switch
  await expect(chip(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(main).toContainText('Play');
  await page.keyboard.press('Shift+ArrowLeft'); // no wrap-around to "whole lesson"
  await expect(chip(0)).toHaveAttribute('aria-pressed', 'true');

  // The small ▶ half: switch AND play; the big half only switches.
  await tapOrClick(page.locator('.fl-nav-next .fl-goplay'), hasTouch);
  await expect(chip(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(main).toContainText('Pause');
  await tapOrClick(page.locator('.fl-next'), hasTouch);
  await expect(chip(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(main).toContainText('Play'); // waits at the start, silent
  await page.keyboard.press('Alt+ArrowLeft'); // ⌥ + arrow = switch and play
  await expect(chip(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(main).toContainText('Pause');
  await tapOrClick(main, hasTouch);
  await expect(page.locator('.fl-nav-prev .fl-goplay')).toBeEnabled();
});

test('many fragments stay on one line and scroll with ‹ ›', async ({ page, hasTouch }, testInfo) => {
  await openApp(page, '?ui=falling');
  const slug = `e2e-many-frags-${testInfo.project.name}-${unique()}`;
  const notes = Array.from({ length: 58 }, (_, i) => ({ pitch: 60 + (i % 8), start: i * 0.5, duration: 0.45, hand: 'R' }));
  const fragments = Array.from({ length: 29 }, (_, i) => ({ title: `Episode ${i + 1}`, start: i, end: i + 1 }));
  await page.locator('input[type=file]').setInputFiles({
    name: `${slug}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ slug, title: `E2E many fragments ${unique()}`, notes, fragments })),
  });
  await expect.poll(async () => (await state(page)).lesson?.slug).toBe(slug);

  const chips = page.locator('.fl-frags .fl-chip');
  await expect(chips).toHaveCount(30); // 29 + whole lesson
  const tops = await chips.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(tops).toBe(1); // one line, never wrapped

  const left = page.locator('.fl-fragsarrow-l');
  const right = page.locator('.fl-fragsarrow-r');
  await expect(left).toBeDisabled();
  await expect(right).toBeEnabled();
  const scroll = () => page.locator('.fl-frags').evaluate((e) => e.scrollLeft);
  await tapOrClick(right, hasTouch);
  await expect.poll(scroll).toBeGreaterThan(50);
  await expect(left).toBeEnabled();

  // Moving to a far fragment brings its chip into view.
  for (let i = 0; i < 27; i++) await page.keyboard.press('Shift+ArrowRight');
  const chip = page.locator('.fl-chip[data-fragment="27"]');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => {
      const [c, r] = await Promise.all([chip.boundingBox(), page.locator('.fl-frags').boundingBox()]);
      return c!.x >= r!.x - 1 && c!.x + c!.width <= r!.x + r!.width + 1;
    })
    .toBe(true);
  expect((await page.request.delete(`/api/lessons/${slug}`)).status()).toBe(204);
});
