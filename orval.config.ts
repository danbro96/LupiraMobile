import { defineConfig } from 'orval';

/**
 * Orval config for the LupiraMtgApi backend.
 *
 * Source spec: `./backend-openapi.json` — refreshed by `npm run fetch:openapi`,
 * which copies from `../LupiraMtgApi/openapi/LupiraMtgApi.json` (emitted at
 * `dotnet build` time via `Microsoft.Extensions.ApiDescription.Server`).
 *
 * Output mode: `tags-split` — one file per OpenAPI tag (Cards, Collections,
 * Selections, Scans, Me, Sets, Admin, Meta). Mobile already buckets features
 * by tag, so split files give cleaner imports and tighter PR diffs.
 *
 * Client: `react-query` — generates `useListCards()` / `useScanCard()` hooks
 * that wrap react-query directly. Replaces both the hand-typed `mtgApi` client
 * and the per-screen `useQuery({ queryFn: () => ... })` boilerplate.
 *
 * Mutator: `./src/api/mutator.ts#apiFetch` — owns base URL, auth token, and
 * error normalisation. Reads `useAuth.getState()` at call time so the API URL
 * override (settings screen) is always picked up live.
 */
export default defineConfig({
  lupiraMtg: {
    input: { target: './backend-openapi.json' },
    output: {
      mode: 'tags-split',
      target: './src/api/generated/api.ts',
      schemas: './src/api/generated/models',
      client: 'react-query',
      httpClient: 'fetch',
      baseUrl: '',
      override: {
        mutator: { path: './src/api/mutator.ts', name: 'apiFetch' },
        query: {
          signal: true,
        },
      },
      clean: true,
    },
  },
});
