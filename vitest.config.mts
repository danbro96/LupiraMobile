import { defineConfig } from 'vitest/config';

// Pure unit tests in a plain node environment — no Expo / React Native runtime.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
