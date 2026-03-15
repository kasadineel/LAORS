-- LAORS Stocker feed tracking
-- Creates the feed pricing, daily feed entry, and shared-pen allocation tables.
-- Also adds the owner billing address field and FEED invoice line source.

BEGIN;

-- Ensure invoice lines can distinguish feed charges from other generated/manual lines.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'InvoiceLineSource'
  ) THEN
    CREATE TYPE "InvoiceLineSource" AS ENUM (
      'YARDAGE',
      'FEED',
      'TREATMENT',
      'MANUAL'
    );
  END IF;
END
$$;

ALTER TYPE "InvoiceLineSource" ADD VALUE IF NOT EXISTS 'YARDAGE';
ALTER TYPE "InvoiceLineSource" ADD VALUE IF NOT EXISTS 'FEED';
ALTER TYPE "InvoiceLineSource" ADD VALUE IF NOT EXISTS 'TREATMENT';
ALTER TYPE "InvoiceLineSource" ADD VALUE IF NOT EXISTS 'MANUAL';

-- Feed entry units are stored in pounds internally.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'FeedEntryUnit'
  ) THEN
    CREATE TYPE "FeedEntryUnit" AS ENUM (
      'LBS'
    );
  END IF;
END
$$;

ALTER TYPE "FeedEntryUnit" ADD VALUE IF NOT EXISTS 'LBS';

-- Printable invoices need an owner billing address.
ALTER TABLE "Owner"
  ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;

CREATE TABLE IF NOT EXISTS "RationCost" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "costPerTon" DOUBLE PRECISION NOT NULL,
  "effectiveStartDate" TIMESTAMP(3) NOT NULL,
  "effectiveEndDate" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RationCost_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RationCost_organizationId_fkey'
  ) THEN
    ALTER TABLE "RationCost"
      ADD CONSTRAINT "RationCost_organizationId_fkey"
      FOREIGN KEY ("organizationId")
      REFERENCES "Organization"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "RationCost_organizationId_effectiveStartDate_idx"
  ON "RationCost" ("organizationId", "effectiveStartDate");

CREATE INDEX IF NOT EXISTS "RationCost_organizationId_isActive_idx"
  ON "RationCost" ("organizationId", "isActive");

CREATE INDEX IF NOT EXISTS "RationCost_organizationId_name_idx"
  ON "RationCost" ("organizationId", "name");

CREATE TABLE IF NOT EXISTS "FeedEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "penId" TEXT NOT NULL,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "rationId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "unit" "FeedEntryUnit" NOT NULL DEFAULT 'LBS',
  "costPerTonSnapshot" DOUBLE PRECISION NOT NULL,
  "totalCostSnapshot" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeedEntry_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FeedEntry_organizationId_fkey'
  ) THEN
    ALTER TABLE "FeedEntry"
      ADD CONSTRAINT "FeedEntry_organizationId_fkey"
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
    SELECT 1 FROM pg_constraint WHERE conname = 'FeedEntry_penId_fkey'
  ) THEN
    ALTER TABLE "FeedEntry"
      ADD CONSTRAINT "FeedEntry_penId_fkey"
      FOREIGN KEY ("penId")
      REFERENCES "Pen"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FeedEntry_rationId_fkey'
  ) THEN
    ALTER TABLE "FeedEntry"
      ADD CONSTRAINT "FeedEntry_rationId_fkey"
      FOREIGN KEY ("rationId")
      REFERENCES "RationCost"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FeedEntry_createdById_fkey'
  ) THEN
    ALTER TABLE "FeedEntry"
      ADD CONSTRAINT "FeedEntry_createdById_fkey"
      FOREIGN KEY ("createdById")
      REFERENCES "User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "FeedEntry_organizationId_entryDate_idx"
  ON "FeedEntry" ("organizationId", "entryDate");

CREATE INDEX IF NOT EXISTS "FeedEntry_penId_entryDate_idx"
  ON "FeedEntry" ("penId", "entryDate");

CREATE INDEX IF NOT EXISTS "FeedEntry_rationId_idx"
  ON "FeedEntry" ("rationId");

CREATE TABLE IF NOT EXISTS "FeedAllocationRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "penId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "allocationPercent" DOUBLE PRECISION NOT NULL,
  "effectiveStartDate" TIMESTAMP(3) NOT NULL,
  "effectiveEndDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeedAllocationRule_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FeedAllocationRule_organizationId_fkey'
  ) THEN
    ALTER TABLE "FeedAllocationRule"
      ADD CONSTRAINT "FeedAllocationRule_organizationId_fkey"
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
    SELECT 1 FROM pg_constraint WHERE conname = 'FeedAllocationRule_penId_fkey'
  ) THEN
    ALTER TABLE "FeedAllocationRule"
      ADD CONSTRAINT "FeedAllocationRule_penId_fkey"
      FOREIGN KEY ("penId")
      REFERENCES "Pen"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FeedAllocationRule_ownerId_fkey'
  ) THEN
    ALTER TABLE "FeedAllocationRule"
      ADD CONSTRAINT "FeedAllocationRule_ownerId_fkey"
      FOREIGN KEY ("ownerId")
      REFERENCES "Owner"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "FeedAllocationRule_organizationId_effectiveStartDate_idx"
  ON "FeedAllocationRule" ("organizationId", "effectiveStartDate");

CREATE INDEX IF NOT EXISTS "FeedAllocationRule_penId_effectiveStartDate_idx"
  ON "FeedAllocationRule" ("penId", "effectiveStartDate");

CREATE INDEX IF NOT EXISTS "FeedAllocationRule_ownerId_effectiveStartDate_idx"
  ON "FeedAllocationRule" ("ownerId", "effectiveStartDate");

COMMIT;
