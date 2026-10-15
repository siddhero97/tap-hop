import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['test/unit/**/*.test.ts'],
    },
  },
  {
    extends: './vitest.integration.config.ts',
    test: {
      name: 'integration',
      include: ['test/integration/**/*.test.ts'],
    },
  },
]);
