#!/usr/bin/env node
// Fails if the dev automation API leaked into the production web build (apps/web/dist).
// Mutating WebMCP tools in a production bundle would be a public API any visitor's agent can call.
// Run after `npm run build`:  npm run check:bundle
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../apps/web/dist/', import.meta.url).pathname;
const MARKERS = ['pianoSteps', 'modelContext', 'registerTool', 'installDevtools', 'press_keys', 'devtools'];

let files;
try {
  files = walk(dist).filter((f) => /\.(js|mjs|html)$/.test(f));
} catch {
  console.error(`No build output at ${dist} — run \`npm run build\` first.`);
  process.exit(2);
}
if (!files.length) {
  console.error(`No .js/.html files in ${dist} — run \`npm run build\` first.`);
  process.exit(2);
}

const leaks = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of MARKERS) if (text.includes(m)) leaks.push(`${f.slice(dist.length)}: contains "${m}"`);
}
if (leaks.length) {
  console.error('Dev automation API found in the production bundle:\n  ' + leaks.join('\n  '));
  process.exit(1);
}
console.log(`ok — ${files.length} files in apps/web/dist, none contains ${MARKERS.join(', ')}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
