import {
  MerchantType,
  OrderStatus,
  PayoutBatch,
  PayoutStatus,
} from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';
import type { Currency } from '../lib/currency.js';
import type { Email } from '../lib/email.js';

/**
 * Database record DTOs and view models for Settlements.
 */

export interface SettlementLedgerRow {
  orderId: string;
  venueName: string;
  partnerNames: string[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  platformFeeCents: number;
  totalCents: number;
  status: PayoutStatus;
  attempts: number;
  lastError: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
}

export type PayoutBatchRecordDto = PayoutBatch;

export interface SettlementOrderWithRelationsDto {
  id: string;
  venueId: string;
  serverStaffId: string | null;
  status: OrderStatus;
  subtotalAmount: Decimal;
  taxAmount: Decimal;
  tipAmount: Decimal;
  platformFeeAmount: Decimal;
  totalAmount: Decimal;
  currency?: Currency;
  venue: {
    id: string;
    paypalEmail: Email;
  };
  serverStaff: {
    id: string;
    paypalEmail: Email;
  } | null;
  items: Array<{
    unitPrice: Decimal;
    quantity: number;
    item: {
      merchantId: string;
      merchant: {
        id: string;
        merchantType: MerchantType;
        commissionRate: Decimal | { toString(): string };
        paypalEmail: Email;
      };
    };
  }>;
  payoutBatch: PayoutBatchRecordDto | null;
}

export interface SettlementOrderWithBatchDto {
  id: string;
  payoutBatch: PayoutBatchRecordDto | null;
}

export interface SettlementBatchWithRelationsDto {
  id: string;
  orderId: string;
  status: PayoutStatus;
  attempts: number;
  lastError: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  order: {
    subtotalAmount: Decimal | { toString(): string };
    taxAmount: Decimal | { toString(): string };
    tipAmount: Decimal | { toString(): string };
    platformFeeAmount: Decimal | { toString(): string };
    totalAmount: Decimal | { toString(): string };
    venue: {
      businessName: string;
    };
    items: Array<{
      item: {
        merchant: {
          merchantType: MerchantType;
          businessName: string;
        };
      };
    }>;
  };
}
