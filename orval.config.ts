import { defineConfig } from 'orval';

/**
 * Orval config for the LupiraMtgApi backend; `backend-openapi.json` is refreshed by `npm run fetch:openapi`.
 *
 * `tags-split` because mobile already buckets features by OpenAPI tag, so per-tag files give cleaner imports and
 * tighter diffs. `client: 'react-query'` generates the hooks that replaced both the hand-typed `mtgApi` client
 * and the per-screen `useQuery({ queryFn: ... })` boilerplate. The mutator reads `useAuth.getState()` at call
 * time, so the settings-screen API URL override applies live.
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
