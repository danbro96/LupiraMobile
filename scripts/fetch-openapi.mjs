#!/usr/bin/env node
/**
 * Refreshes `backend-openapi.json` at the repo root. This is what Orval reads
 * — re-running this script + `npm run generate:api` is the standard loop for
 * picking up backend contract changes.
 *
 * Three sources, tried in order:
 *
 *  1. **Sibling LupiraMtgApi build output** (default, no args).
 *     If `../LupiraMtgApi/openapi/LupiraMtgApi.json` exists, we copy it. The
 *     backend project is wired with `Microsoft.Extensions.ApiDescription.Server`
 *     so a `dotnet build` of LupiraMtgApi emits this file. No DB / running
 *     server required — the build-time emitter loads the assembly and walks
 *     the document provider in-process.
 *
 *  2. **A running server URL** (`npm run fetch:openapi -- http://localhost:5188/openapi/v1.json`).
 *     Falls back to plain HTTP fetch.
 *
 *  3. **Production** (`npm run fetch:openapi -- https://mtg-api.lupira.com/openapi/v1.json`).
 *     Same code path as #2.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outFile = path.join(repoRoot, 'backend-openapi.json');

const arg = process.argv[2];

if (arg) {
  console.log(`Fetching ${arg} …`);
  const res = await fetch(arg);
  if (!res.ok) {
    console.error(`Failed: ${res.status} ${res.statusText} from ${arg}`);
    process.exit(1);
  }
  const json = await res.json();
  await fs.writeFile(outFile, JSON.stringify(json, null, 2) + '\n');
  console.log(`Wrote ${outFile} (${(JSON.stringify(json).length / 1024).toFixed(1)} KB)`);
} else {
  // Sibling build-output path. LupiraMtgApi's csproj writes to
  // `<repo-root>/openapi/LupiraMtgApi.json` after a successful `dotnet build`.
  const sibling = path.resolve(repoRoot, '..', 'LupiraMtgApi', 'openapi', 'LupiraMtgApi.json');
  try {
    const json = JSON.parse(await fs.readFile(sibling, 'utf-8'));
    await fs.writeFile(outFile, JSON.stringify(json, null, 2) + '\n');
    console.log(`Copied ${sibling} → ${outFile} (${(JSON.stringify(json).length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(
      `No sibling spec at ${sibling}. Either:\n` +
      `  • Run \`dotnet build\` in ../LupiraMtgApi to emit it, or\n` +
      `  • Pass a URL: \`npm run fetch:openapi -- https://mtg-api.lupira.com/openapi/v1.json\``,
    );
    console.error(`(${e instanceof Error ? e.message : String(e)})`);
    process.exit(1);
  }
}
