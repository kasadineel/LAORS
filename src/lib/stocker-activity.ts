import { Prisma, StockerActivityType } from "@prisma/client"
import { prisma } from "@/lib/prisma"

type StockerActivityClient = typeof prisma | Prisma.TransactionClient

type LogStockerActivityInput = {
  organizationId: string
  type: StockerActivityType
  message: string
  metadata?: Prisma.InputJsonValue
  createdByUserId?: string | null
}

export async function logStockerActivity(
  {
    organizationId,
    type,
    message,
    metadata,
    createdByUserId,
  }: LogStockerActivityInput,
  client: StockerActivityClient = prisma,
) {
  await client.stockerActivity.create({
    data: {
      organizationId,
      type,
      message,
      metadata,
      createdByUserId: createdByUserId ?? null,
    },
  })
}
