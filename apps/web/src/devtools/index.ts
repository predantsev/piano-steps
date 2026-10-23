import { createDevApi } from './api.ts';
import type { DevShell } from './shell.ts';
import { registerWebMcpTools } from './webmcp.ts';

/**
 * Dev automation API for agents and e2e tests — `window.pianoSteps` plus the same operations as
 * WebMCP tools on `document.modelContext` (when the browser has it). Docs: docs/testing-api.md.
 *
 * App.tsx loads this module with a dynamic `import()` inside `if (import.meta.env.DEV)`, so it is
 * not part of a production build (mutating tools must never ship: any visitor's agent could call them).
 *
 * Returns a dispose function. Safe to call repeatedly (React StrictMode mounts effects twice).
 */
export function installDevtools(getShell: () => DevShell): () => void {
  const { api, dispose } = createDevApi(getShell);
  window.pianoSteps = api;
  void registerWebMcpTools();
  return () => {
    dispose();
    if (window.pianoSteps === api) delete window.pianoSteps;
  };
}

export type { DevState, PianoStepsDevApi } from './types.ts';
