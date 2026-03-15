-- LAORS Stocker: Lot total-weight model
-- Adds all current lot weight fields expected by prisma/schema.prisma.
-- This keeps the operator-first group-weighing model:
-- - head counts are stored separately
-- - total weights are stored on the lot
-- - average weights are derived in the app

BEGIN;

ALTER TABLE "Lot"
  ADD COLUMN IF NOT EXISTS "inHeadCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "inTotalWeight" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "outHeadCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "outTotalWeight" DOUBLE PRECISION;

COMMIT;
