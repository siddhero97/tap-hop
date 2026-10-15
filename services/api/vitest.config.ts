import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
      },
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage/unit',
      exclude: [
        ...(configDefaults.coverage?.exclude ?? []),
        'src/server.ts',
        'src/app.ts',
        'src/config/env.ts',
        'src/lib/logger.ts',
        '**/*.config.*',
      ],
    },
  },
  resolve: {
    alias: {
      '@prisma/client/runtime/library': path.resolve(__dirname, 'test/setup.ts'),
      '@prisma/client': path.resolve(__dirname, 'test/setup.ts'),
    },
  },
});
