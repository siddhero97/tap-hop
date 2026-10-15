import { vi } from 'vitest';

// Set up environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
process.env.PAYPAL_MODE = 'sandbox';
process.env.PAYPAL_CLIENT_ID = 'test-client-id';
process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
process.env.PAYPAL_WEBHOOK_ID = 'test-webhook-id';
process.env.LOG_LEVEL = 'error';

// Mock Decimal class for testing
export class Decimal {
  private value: string;

  constructor(value: string | number) {
    this.value = String(value);
  }

  toString(): string {
    return this.value;
  }

  toFixed(places: number): string {
    const num = parseFloat(this.value);
    return num.toFixed(places);
  }
}

// Mock @prisma/client module
export const mockDecimal = Decimal;

// Mock PrismaClient for integration tests
const createTableMock = () => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  count: vi.fn(),
  createMany: vi.fn(),
});

export class PrismaClient {
  order = createTableMock();
  payoutBatch = createTableMock();
  payoutBatchItem = createTableMock();
  webhookEvent = createTableMock();
  merchant = createTableMock();
  item = createTableMock();
  orderItem = createTableMock();
  staff = createTableMock();

  $transaction = vi.fn();
  $queryRaw = vi.fn();
}

// Mock logger to prevent configuration issues
vi.mock('../../src/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Enums for testing
export enum OrderStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
}

export enum PayoutStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum MerchantType {
  PRIMARY_VENUE = 'PRIMARY_VENUE',
  EXTERNAL_PARTNER = 'EXTERNAL_PARTNER',
}

// Mock @prisma/client before it's imported
vi.mock('@prisma/client', () => ({
  PrismaClient,
  Decimal,
  OrderStatus,
  PayoutStatus,
  MerchantType,
}));
