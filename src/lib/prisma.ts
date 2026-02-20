import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

const connectionString =
  process.env.DATABASE_URL || process.env.DIRECT_URL

if (!connectionString) {
  throw new Error("Missing DATABASE_URL (or DIRECT_URL) in environment variables")
}

const adapter = new PrismaPg({ connectionString })

export const prisma =
  globalThis.__prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma