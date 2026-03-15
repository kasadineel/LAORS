DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'StockerActivityType'
  ) THEN
    CREATE TYPE "StockerActivityType" AS ENUM (
      'INTAKE',
      'MOVE',
      'SPLIT',
      'CLOSE_LOT',
      'TREATMENT',
      'INVOICE_CREATED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "StockerActivity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" "StockerActivityType" NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockerActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockerActivity_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockerActivity_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "StockerActivity_organizationId_createdAt_idx"
  ON "StockerActivity"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "StockerActivity_createdByUserId_idx"
  ON "StockerActivity"("createdByUserId");
