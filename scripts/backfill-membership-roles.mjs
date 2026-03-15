import "dotenv/config"

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL
}

const { PrismaClient } = await import("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const [column] = await prisma.$queryRawUnsafe(`
    SELECT data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'Membership' AND column_name = 'role'
    LIMIT 1
  `)

  if (!column) {
    console.log("Membership.role column not found.")
    return
  }

  const isEnumColumn =
    column.udt_name === "MembershipRole" || column.data_type === "USER-DEFINED"

  if (isEnumColumn) {
    console.log("Membership.role already uses MembershipRole enum. No backfill needed.")
    return
  }

  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Membership"
    SET "role" = CASE
      WHEN "role" = 'OWNER' THEN 'OWNER'
      WHEN "role" = 'ADMIN' THEN 'MANAGER'
      WHEN "role" = 'MANAGER' THEN 'MANAGER'
      WHEN "role" = 'MEMBER' THEN 'WORKER'
      WHEN "role" = 'WORKER' THEN 'WORKER'
      ELSE 'WORKER'
    END
  `)

  console.log(`Backfilled Membership.role values for ${result} row(s).`)
  console.log("Rerun `npx prisma db push` and `npx prisma generate` after this script if the column is still text.")
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
