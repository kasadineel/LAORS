DO $$
BEGIN
  CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'MANAGER', 'WORKER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Membership"
ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "Membership"
ALTER COLUMN "role" TYPE "MembershipRole"
USING (
  CASE
    WHEN "role" = 'OWNER' THEN 'OWNER'::"MembershipRole"
    WHEN "role" = 'ADMIN' THEN 'MANAGER'::"MembershipRole"
    WHEN "role" = 'MANAGER' THEN 'MANAGER'::"MembershipRole"
    WHEN "role" = 'MEMBER' THEN 'WORKER'::"MembershipRole"
    WHEN "role" = 'WORKER' THEN 'WORKER'::"MembershipRole"
    ELSE 'WORKER'::"MembershipRole"
  END
);

ALTER TABLE "Membership"
ALTER COLUMN "role" SET DEFAULT 'WORKER';
