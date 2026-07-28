import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The default suite: argument construction, output parsing, validation, filename
 * sanitizing, the job queue and the spawn wrapper. These are the parts where a
 * mistake is silent — a wrong flag or a missed progress line looks like working
 * software. React components are left to manual checking for now.
 *
 * Nothing here touches the network. The tests that drive the real yt-dlp are
 * *.integration.test.ts and run from vitest.integration.config.mts.
 */
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    // runner.test.ts spawns real processes, which is slower than a pure unit test.
    testTimeout: 20_000,
  },
});
