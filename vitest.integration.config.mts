import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Opt-in suite (`npm run test:integration`). These tests drive the real yt-dlp,
 * ffmpeg and ffprobe against YouTube, so they need network access and the tools
 * on PATH — which is exactly why they are not part of `npm test`.
 *
 * Keeping them separate rather than behind an environment variable avoids needing
 * a cross-platform way to set one.
 */
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // A real download plus post-processing, on a slow connection.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // They share a destination folder and compete for bandwidth otherwise.
    fileParallelism: false,
  },
});
