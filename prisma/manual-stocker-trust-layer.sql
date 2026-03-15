-- LAORS Stocker trust layer
-- Applies:
-- 1) LotLedgerEventType enum
-- 2) InvoiceStatus enum
-- 3) InvoiceLineSource enum
-- 4) LotEventLedger table + FKs + indexes
-- 5) Invoice lifecycle columns
-- 6) InvoiceLine source/generated columns

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'LotLedgerEventType'
  ) THEN
    CREATE TYPE "LotLedgerEventType" AS ENUM (
      'INTAKE',
      'ADJUSTMENT',
      'SPLIT_OUT',
      'SPLIT_IN',
      'OWNER_PICKUP',
      'DEATH_LOSS',
      'ADDITION',
      'MOVE',
      'CLOSE',
      'SHIPMENT_OUT',
      'COUNT_CORRECTION'
    );
  END IF;
END
$$;

ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'INTAKE';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'SPLIT_OUT';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'SPLIT_IN';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'OWNER_PICKUP';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'DEATH_LOSS';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'ADDITION';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'MOVE';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'CLOSE';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'SHIPMENT_OUT';
ALTER TYPE "LotLedgerEventType" ADD VALUE IF NOT EXISTS 'COUNT_CORRECTION';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'InvoiceStatus'
  ) THEN
    CREATE TYPE "InvoiceStatus" AS ENUM (
      'DRAFT',
      'FINALIZED',
      'VOID'
    );
  END IF;
END
$$;

ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'FINALIZED';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'VOID';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'InvoiceLineSource'
  ) THEN
    CREATE TYPE "InvoiceLineSource" AS ENUM (
      'YARDAGE',
      'TREATMENT',
      'MANUAL'
    );
  END IF;
END
$$;

ALTER TYPE "InvoiceLineSource" ADD VALUE IF NOT EXISTS 'YARDAGE';
ALTER TYPE "InvoiceLineSource" ADD VALUE IF NOT EXISTS 'TREATMENT';
ALTER TYPE "InvoiceLineSource" ADD VALUE IF NOT EXISTS 'MANUAL';

CREATE TABLE IF NOT EXISTS "LotEventLedger" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "eventType" "LotLedgerEventType" NOT NULL,
  "eventDate" TIMESTAMP(3) NOT NULL,
  "headChange" INTEGER NOT NULL,
  "headAfter" INTEGER NOT NULL,
  "notes" TEXT,
  "createdById" TEXT,
  "relatedLotId" TEXT,
  "relatedOwnerId" TEXT,
  "relatedPenId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LotEventLedger_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LotEventLedger_organizationId_fkey'
  ) THEN
    ALTER TABLE "LotEventLedger"
      ADD CONSTRAINT "LotEventLedger_organizationId_fkey"
      FOREIGN KEY ("organizationId")
      REFERENCES "Organization"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LotEventLedger_lotId_fkey'
  ) THEN
    ALTER TABLE "LotEventLedger"
      ADD CONSTRAINT "LotEventLedger_lotId_fkey"
      FOREIGN KEY ("lotId")
      REFERENCES "Lot"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LotEventLedger_createdById_fkey'
  ) THEN
    ALTER TABLE "LotEventLedger"
      ADD CONSTRAINT "LotEventLedger_createdById_fkey"
      FOREIGN KEY ("createdById")
      REFERENCES "User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "LotEventLedger_lotId_eventDate_idx"
  ON "LotEventLedger" ("lotId", "eventDate");

CREATE INDEX IF NOT EXISTS "LotEventLedger_organizationId_eventDate_idx"
  ON "LotEventLedger" ("organizationId", "eventDate");

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "billingMonth" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "finalizedById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_finalizedById_fkey'
  ) THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT "Invoice_finalizedById_fkey"
      FOREIGN KEY ("finalizedById")
      REFERENCES "User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Invoice_ownerId_billingMonth_idx"
  ON "Invoice" ("ownerId", "billingMonth");

CREATE INDEX IF NOT EXISTS "Invoice_organizationId_billingMonth_status_idx"
  ON "Invoice" ("organizationId", "billingMonth", "status");

ALTER TABLE "InvoiceLine"
  ADD COLUMN IF NOT EXISTS "source" "InvoiceLineSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "generated" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
