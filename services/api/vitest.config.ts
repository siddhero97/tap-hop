import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
  resolve: {
    alias: {
      '@prisma/client': path.resolve(__dirname, 'test/setup.ts'),
    },
  },
});
