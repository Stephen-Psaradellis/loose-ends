// Unit tests cover the pure model (sort, dwell, save/load); the IWSDK Vite plugin
// is left out because it boots a dev browser.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
