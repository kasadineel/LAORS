-- LAORS Stocker employee management
-- Adds an active flag to memberships so access can be deactivated without deleting history.

BEGIN;

ALTER TABLE "Membership"
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
