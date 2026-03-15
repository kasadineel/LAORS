import { PrismaClient } from "@prisma/client"

declare global {
  var prisma: PrismaClient | undefined
}

export const prisma =
  global.prisma ??
  new PrismaClient()

if (process.env.NODE_ENV !== "production")
  global.prisma = prisma

export function getStockerActivityDelegate() {
  const delegate = (prisma as { stockerActivity?: PrismaClient["stockerActivity"] }).stockerActivity

  if (!delegate) {
    throw new Error(
      'Prisma Client is stale: `prisma.stockerActivity` is unavailable. Run `npx prisma generate`, clear `.next`, and restart the dev server.',
    )
  }

  return delegate as PrismaClient["stockerActivity"]
}

export function getMedicineDelegate() {
  const delegate = (prisma as { medicine?: PrismaClient["medicine"] }).medicine

  if (!delegate) {
    throw new Error(
      'Prisma Client is stale: `prisma.medicine` is unavailable. Run `npx prisma generate`, clear `.next`, and restart the dev server.',
    )
  }

  return delegate as PrismaClient["medicine"]
}

export function getRationCostDelegate() {
  const delegate = (prisma as { rationCost?: PrismaClient["rationCost"] }).rationCost

  if (!delegate) {
    throw new Error(
      'Prisma Client is stale: `prisma.rationCost` is unavailable. Run `npx prisma generate`, clear `.next`, and restart the dev server.',
    )
  }

  return delegate as PrismaClient["rationCost"]
}

export function getLotEventLedgerDelegate() {
  const delegate = (prisma as { lotEventLedger?: PrismaClient["lotEventLedger"] }).lotEventLedger

  if (!delegate) {
    throw new Error(
      'Prisma Client is stale: `prisma.lotEventLedger` is unavailable. Run `npx prisma generate`, clear `.next`, and restart the dev server.',
    )
  }

  return delegate as PrismaClient["lotEventLedger"]
}
