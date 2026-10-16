-- Enable PostGIS extension for spatial geography queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM (
  'PATRON',
  'STAFF',
  'MERCHANT_ADMIN',
  'PLATFORM_SUPPORT',
  'PLATFORM_FINANCE',
  'PLATFORM_ADMIN'
);

-- AlterTable: add WGS84 coordinates and default delivery radius (meters) to Merchant
ALTER TABLE "Merchant"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "deliveryRadiusM" INTEGER NOT NULL DEFAULT 500;

-- Coordinate range and positive radius constraints
ALTER TABLE "Merchant"
  ADD CONSTRAINT "Merchant_latitude_range_chk" CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)),
  ADD CONSTRAINT "Merchant_longitude_range_chk" CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180)),
  ADD CONSTRAINT "Merchant_deliveryRadiusM_positive_chk" CHECK ("deliveryRadiusM" > 0);

-- PostGIS GIST functional index on geography point (SRID 4326)
CREATE INDEX "Merchant_location_gist_idx"
  ON "Merchant"
  USING GIST ((ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography))
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- CreateTable: User
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PATRON',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "merchantId" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Session
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PlatformSettings
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "platformFeeBps" INTEGER NOT NULL DEFAULT 500,
    "taxRateBps" INTEGER NOT NULL DEFAULT 800,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformSettings_bps_non_negative_chk" CHECK ("platformFeeBps" >= 0 AND "taxRateBps" >= 0)
);

-- AlterTable: Order (optional patronUserId)
ALTER TABLE "Order" ADD COLUMN "patronUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_staffId_key" ON "User"("staffId");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_patronUserId_fkey" FOREIGN KEY ("patronUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
