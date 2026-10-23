import { expect, openApp, state, tapOrClick, test } from './fixtures.ts';

/** The dev automation API itself: `window.pianoSteps` everywhere, WebMCP where the browser has it. */

test('window.pianoSteps presses keys, reads lit keys and plays', async ({ page, hasTouch }) => {
  await openApp(page, '?lesson=ode-to-joy&ui=falling');

  expect((await state(page)).display.framesRunning).toBe(true);
  const held = await page.evaluate(() => window.pianoSteps!.press(['C4', 'E4', 67]));
  expect(held.heldKeys).toEqual([60, 64, 67]);
  expect(held.litKeys.map((k) => k.name)).toEqual(['C4', 'E4', 'G4']);
  const released = await page.evaluate(() => window.pianoSteps!.release());
  expect(released.heldKeys).toEqual([]);
  expect(released.litKeys).toEqual([]);

  const whileHeld = await page.evaluate(() => window.pianoSteps!.press('A3', 100));
  expect(whileHeld.litKeys.map((k) => k.pitch)).toEqual([57]);
  expect((await state(page)).heldKeys).toEqual([]);

  // Sound (and on iOS the clock) starts only after a real gesture: tap the page once.
  await tapOrClick(page.locator('.brand'), hasTouch);
  await expect.poll(async () => (await state(page)).player.audioContext).toBe('running');
  const playing = await page.evaluate(() => window.pianoSteps!.play(0, 4));
  expect(playing.warning).toBeUndefined();
  expect(playing.player).toMatchObject({ state: 'playing', from: 0, to: 4, audioUnlocked: true });
  await expect.poll(async () => (await state(page)).player.time).toBeGreaterThan(0.3);
  expect((await page.evaluate(() => window.pianoSteps!.stop())).player.state).toBe('stopped');
});

test('window.pianoSteps switches lesson and variant and reports errors', async ({ page }) => {
  await openApp(page);
  const lessons = await page.evaluate(() => window.pianoSteps!.listLessons());
  expect(lessons.map((l) => l.slug)).toEqual(expect.arrayContaining(['ode-to-joy', 'twinkle-twinkle']));

  const s1 = await page.evaluate(() => window.pianoSteps!.selectLesson('twinkle-twinkle'));
  expect(s1).toMatchObject({ ready: true, lesson: { slug: 'twinkle-twinkle' } });
  const s2 = await page.evaluate(() => window.pianoSteps!.setVariant('sheet'));
  expect(s2.variant).toBe('sheet');
  await expect(page.locator('[role=tab][aria-pressed=true]')).toHaveText('Sheet + keys');
  await expect(page).toHaveURL(/ui=sheet/);

  const err = await page.evaluate(() => window.pianoSteps!.selectLesson('no-such-lesson').then(() => 'resolved', (e: Error) => e.message));
  expect(err).toMatch(/No lesson "no-such-lesson"/);
});

test('WebMCP tools run through document.modelContext', async ({ page }) => {
  const { webmcp } = await openApp(page, '?lesson=ode-to-joy');
  test.skip(!webmcp.available, 'this browser has no document.modelContext (WebKit; Chromium needs --enable-features=WebMCPTesting)');

  await expect.poll(async () => (await state(page)).webmcp.tools.length).toBe(8);
  // The raw browser API, as an outside agent would call it (Chromium 156: args as an object).
  const raw = await page.evaluate(async () => {
    const mc = (document as unknown as { modelContext: { getTools(): Promise<{ name: string }[]>; executeTool(t: unknown, a: unknown): Promise<string> } }).modelContext;
    const tools = await mc.getTools();
    const press = tools.find((t) => t.name === 'press_keys');
    const out = await mc.executeTool(press, { pitches: ['D4', 'F#4'] });
    return { names: tools.map((t) => t.name).sort(), result: JSON.parse(JSON.parse(out).content[0].text) };
  });
  expect(raw.names).toEqual(
    expect.arrayContaining(['get_state', 'list_lessons', 'select_lesson', 'set_variant', 'press_keys', 'release_keys', 'play', 'stop']),
  );
  expect(raw.result.heldKeys).toEqual([62, 66]);
  expect(raw.result.litKeys.map((k: { name: string }) => k.name)).toEqual(['D4', 'F#4']);

  // The same tools through the helper.
  const call = (name: string, args: Record<string, unknown> = {}) =>
    page.evaluate(([n, a]) => window.pianoSteps!.callTool(n, a), [name, args] as const);
  expect(await call('release_keys')).toMatchObject({ heldKeys: [] });
  expect(await call('select_lesson', { slug: 'twinkle-twinkle' })).toMatchObject({ lesson: { slug: 'twinkle-twinkle' } });
  expect(await call('set_variant', { id: 'cards' })).toMatchObject({ variant: 'cards' });
  expect(await call('get_state')).toMatchObject({ variant: 'cards', lesson: { slug: 'twinkle-twinkle' } });
  // A failing tool answers { error } instead of throwing (a throw would reach the agent as "UnknownError").
  expect(await call('set_variant', { id: 'nope' })).toEqual({ error: 'No variant "nope". Available: falling, cards, sheet' });
});
