import type { PianoStepsDevApi } from './types.ts';

/**
 * The dev automation API as WebMCP tools on `document.modelContext` (dev builds only).
 *
 * Measured on Chromium 156 (Playwright, `--enable-features=WebMCPTesting`): `registerTool` returns
 * a Promise and rejects a duplicate name with InvalidStateError; there is no `unregisterTool`;
 * `executeTool(registeredTool, argsObject)` returns a JSON string `{content:[{type:'text',text}]}`;
 * a throwing `execute` surfaces only as "UnknownError", so tools return `{ error }` instead.
 * Chrome 152 wanted the args as a JSON string — `callWebMcpTool` tries both.
 *
 * Tools dispatch through `window.pianoSteps` (whatever is installed now), so a re-install after
 * HMR or React StrictMode keeps the already registered tools working.
 */

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(api: PianoStepsDevApi, args: Record<string, unknown>): unknown;
}

interface RegisteredTool {
  name: string;
}
interface ModelContext {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: unknown) => Promise<{ content: { type: 'text'; text: string }[] }>;
  }): Promise<unknown>;
  getTools(): Promise<RegisteredTool[]>;
  executeTool(tool: RegisteredTool, args: unknown): Promise<unknown>;
}

const modelContext = () => (document as unknown as { modelContext?: ModelContext }).modelContext;

const pitchList = {
  type: 'array',
  items: { anyOf: [{ type: 'integer', minimum: 21, maximum: 108 }, { type: 'string' }] },
  description: 'Piano keys as MIDI numbers (60 = middle C) or names like "C4", "F#3", "Bb2".',
};

export const TOOLS: ToolDef[] = [
  {
    name: 'get_state',
    description:
      'Read what the piano-steps practice screen shows right now: the open lesson, the practice view ' +
      '(variant), the current fragment, the player (state, time in seconds, whether audio is unlocked), the ' +
      'keys held down, the keys lit on the on-screen keyboard, the last key events, and any state the view ' +
      'published. Use it instead of a screenshot to check what happened.',
    inputSchema: { type: 'object', properties: {} },
    run: (api) => api.getState(),
  },
  {
    name: 'list_lessons',
    description: 'List the lessons in the database (slug, title, duration, note and fragment counts).',
    inputSchema: { type: 'object', properties: {} },
    run: (api) => api.listLessons(),
  },
  {
    name: 'select_lesson',
    description: 'Open a lesson by its slug (or id), as if the user picked it in the top bar. Returns the new state once it is on screen.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Lesson slug from list_lessons, e.g. "ode-to-joy"' } },
      required: ['slug'],
    },
    run: (api, a) => api.selectLesson(String(a.slug ?? '')),
  },
  {
    name: 'set_variant',
    description:
      'Switch the practice view (the tabs in the top bar): "falling" (falling notes), "cards" (step-by-step ' +
      'cards), "sheet" (notation + keys). Returns the new state once the view has rendered.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Variant id; get_state().variants lists them' } },
      required: ['id'],
    },
    run: (api, a) => api.setVariant(String(a.id ?? '')),
  },
  {
    name: 'press_keys',
    description:
      'Press piano keys like a finger on the on-screen keyboard (a chord if several). Without holdMs the ' +
      'keys stay down until release_keys; with holdMs they are released after that many milliseconds and ' +
      'the returned state is the one while they were held.',
    inputSchema: {
      type: 'object',
      properties: {
        pitches: pitchList,
        holdMs: { type: 'number', minimum: 0, description: 'Hold time in milliseconds (optional)' },
      },
      required: ['pitches'],
    },
    run: (api, a) => api.press(a.pitches as (number | string)[], a.holdMs as number | undefined),
  },
  {
    name: 'release_keys',
    description: 'Release keys pressed with press_keys. Without pitches, releases every held key.',
    inputSchema: { type: 'object', properties: { pitches: pitchList } },
    run: (api, a) => api.release(a.pitches as (number | string)[] | undefined),
  },
  {
    name: 'play',
    description:
      'Play the lesson with the piano sound from `from` to `to` seconds (default: the current fragment, or ' +
      'the whole lesson). The result has `warning` if the page has not had a real tap yet — browsers keep ' +
      'audio (and the player clock) frozen until then.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'number', minimum: 0, description: 'Start, seconds' },
        to: { type: 'number', minimum: 0, description: 'End, seconds' },
      },
    },
    run: (api, a) => api.play(a.from as number | undefined, a.to as number | undefined),
  },
  {
    name: 'stop',
    description: 'Stop playback.',
    inputSchema: { type: 'object', properties: {} },
    run: (api) => api.stop(),
  },
];

const registered = new Set<string>();
let registering: Promise<void> | null = null;

export const registeredToolNames = () => [...registered];

/** Register every tool once per page. No-op (and no error) where WebMCP does not exist. */
export function registerWebMcpTools(): Promise<void> {
  const mc = modelContext();
  if (!mc) return Promise.resolve();
  registering ??= (async () => {
    for (const t of TOOLS) {
      try {
        await mc.registerTool({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          execute: async (raw) => {
            let result: unknown;
            try {
              const api = window.pianoSteps;
              if (!api) throw new Error('window.pianoSteps is not installed (is this a dev build?)');
              const args = (typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {})) as Record<string, unknown>;
              result = await t.run(api, args);
            } catch (e) {
              result = { error: e instanceof Error ? e.message : String(e) };
            }
            return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
          },
        });
        registered.add(t.name);
      } catch (e) {
        // Already registered by an earlier copy of this module (HMR): it dispatches through window.pianoSteps.
        if (e instanceof Error && /duplicate/i.test(e.message)) registered.add(t.name);
        else console.warn(`[pianoSteps] WebMCP registerTool(${t.name}) failed:`, e);
      }
    }
  })();
  return registering;
}

/** Call a registered tool through the real `document.modelContext` pipe; returns the parsed result. */
export async function callWebMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const mc = modelContext();
  if (!mc)
    throw new Error('WebMCP is not available in this browser (document.modelContext is undefined) — call window.pianoSteps methods directly');
  await registerWebMcpTools();
  const tool = (await mc.getTools()).find((t) => t.name === name);
  if (!tool) throw new Error(`No WebMCP tool "${name}". Registered: ${registeredToolNames().join(', ')}`);
  let raw: unknown;
  try {
    raw = await mc.executeTool(tool, args);
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    raw = await mc.executeTool(tool, JSON.stringify(args)); // Chrome 152 shape
  }
  const res = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { content?: { text?: string }[] };
  const text = res?.content?.[0]?.text;
  return text === undefined ? res : JSON.parse(text);
}
