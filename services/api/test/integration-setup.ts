import { beforeEach, afterAll } from 'vitest';
import {
  disconnectTestDatabase,
  resetTestDatabase,
  type TestBatchCountDto,
} from './helpers/test-db.repository.js';

beforeEach(async () => {
  const deletedBatches: TestBatchCountDto[] = await resetTestDatabase();
  void deletedBatches;
});

afterAll(async () => {
  await disconnectTestDatabase();
});
