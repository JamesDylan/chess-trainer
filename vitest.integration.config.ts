import { defineConfig } from 'vitest/config';

// Separate config for the REAL-engine integration gate so it never runs as part
// of the fast, deterministic `npm test`. Run with: npm run engine:check
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.itest.ts'],
    testTimeout: 40_000,
    hookTimeout: 30_000,
  },
});
