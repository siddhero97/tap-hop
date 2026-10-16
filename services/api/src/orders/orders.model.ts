import {
  MerchantType,
  OrderStatus as PrismaOrderStatus,
  PayoutStatus,
} from '@tabhop/database';
import { Decimal } from '@prisma/client/runtime/library';
import type { Email } from '../lib/email.js';

export enum OrderStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
}

export enum RecipientType {
  PRIMARY_VENUE = 'PRIMARY_VENUE',
  PARTNER_MERCHANT = 'PARTNER_MERCHANT',
  STAFF_TIP = 'STAFF_TIP',
  PLATFORM_FEE = 'PLATFORM_FEE',
}

export interface OrderWithItems {
  id: string;
  venueId: string;
  serverStaffId?: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  platformFeeCents: number;
  totalCents: number;
  items: Array<{
    merchantId: string;
    merchantType: MerchantType;
    commissionRate: number;
    lineCents: number;
  }>;
}

export interface SplitRow {
  recipientType: RecipientType;
  merchantId?: string;
  staffId?: string;
  receiverEmail: Email;
  amountCents: number;
}

/**
 * Database record DTOs for Orders module.
 */

export interface OrderRecordDto {
  id: string;
  venueId: string;
  serverStaffId: string | null;
  tableNumber: string | null;
  status: PrismaOrderStatus;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  subtotalAmount: Decimal;
  taxAmount: Decimal;
  tipAmount: Decimal;
  platformFeeAmount: Decimal;
  totalAmount: Decimal;
  currency: string;
  idempotencyKey: string | null;
  capturedAt: Date | null;
  createdAt: Date;
}

export interface OrderItemWithItemRecordDto {
  id: string;
  orderId: string;
  itemId: string;
  quantity: number;
  unitPrice: Decimal;
  item: {
    id: string;
    name: string;
    price: Decimal;
    isActive: boolean;
    merchantId: string;
  };
}

export interface OrderWithItemsRecordDto extends OrderRecordDto {
  items: OrderItemWithItemRecordDto[];
}

export interface OrderWithDetailsRecordDto extends OrderWithItemsRecordDto {
  payoutBatch: {
    id: string;
    paypalBatchId: string | null;
    status: PayoutStatus;
  } | null;
}

export interface CatalogItemWithMerchantRecordDto {
  id: string;
  name: string;
  price: Decimal;
  isActive: boolean;
  merchantId: string;
  merchant: {
    id: string;
    merchantType: MerchantType;
  };
}

export interface VenueRecordDto {
  id: string;
  merchantType: MerchantType;
}

export interface StaffRecordDto {
  id: string;
  venueId: string;
}
