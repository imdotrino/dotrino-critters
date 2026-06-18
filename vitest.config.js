import { defineConfig } from 'vitest/config';

// Tests UNITARIOS deterministas (lógica pura: forge, types, fusión, ingredientes).
// Los E2E viven en tests/e2e/*.spec.js y los corre Playwright (`npm test`), NO Vitest.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
  },
});
