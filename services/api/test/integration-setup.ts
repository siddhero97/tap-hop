import { beforeEach, afterAll } from 'vitest';
import { prisma } from '@tabhop/database';

const TABLES = [
  'PayoutBatchItem',
  'PayoutBatch',
  'OrderItem',
  'Order',
  'WebhookEvent',
  'Item',
  'Staff',
  'Merchant',
];

beforeEach(async () => {
  const quoted = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
