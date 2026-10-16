import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

function loadDotEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line
      .slice(eqIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && val !== '') {
      parsed[key] = val;
    }
  }
  return parsed;
}

const rootEnv = loadDotEnv(path.resolve(__dirname, '../../.env'));
const localEnv = loadDotEnv(path.resolve(__dirname, '.env'));
const mergedDotEnv = { ...rootEnv, ...localEnv };

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  mergedDotEnv.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/tabhop_test';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/sandbox/**/*.test.ts'],
    setupFiles: ['test/integration-setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    poolOptions: {
      threads: {
        singleThread: true,
      },
      forks: {
        singleFork: true,
      },
    },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      PAYPAL_MODE: 'sandbox',
      PAYPAL_CLIENT_ID:
        process.env.PAYPAL_CLIENT_ID ||
        mergedDotEnv.PAYPAL_CLIENT_ID ||
        'MISSING_SANDBOX_CLIENT_ID',
      PAYPAL_CLIENT_SECRET:
        process.env.PAYPAL_CLIENT_SECRET ||
        mergedDotEnv.PAYPAL_CLIENT_SECRET ||
        'MISSING_SANDBOX_CLIENT_SECRET',
      PAYPAL_WEBHOOK_ID:
        process.env.PAYPAL_WEBHOOK_ID || mergedDotEnv.PAYPAL_WEBHOOK_ID || 'SANDBOX_WEBHOOK_ID',
      LOG_LEVEL: 'error',
    },
  },
});
