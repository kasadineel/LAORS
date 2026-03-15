import { LotAdjustmentType, LotLedgerEventType, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

const DAY_IN_MS = 24 * 60 * 60 * 1000

type LedgerClient = typeof prisma | Prisma.TransactionClient

type LotLedgerSnapshot = {
  eventDate: Date
  headChange: number
  headAfter: number
}

type RecordLotLedgerEventInput = {
  organizationId: string
  lotId: string
  eventType: LotLedgerEventType
  eventDate: Date
  headChange: number
  headAfter: number
  notes?: string | null
  createdById?: string | null
  relatedLotId?: string | null
  relatedOwnerId?: string | null
  relatedPenId?: string | null
  metadata?: Prisma.InputJsonValue
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function getBillingMonthValue(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`
}

export function getLotLedgerEventTypeForAdjustment(type: LotAdjustmentType) {
  switch (type) {
    case LotAdjustmentType.DEATH_LOSS:
      return LotLedgerEventType.DEATH_LOSS
    case LotAdjustmentType.OWNER_PICKUP:
      return LotLedgerEventType.OWNER_PICKUP
    case LotAdjustmentType.SHIPMENT_OUT:
      return LotLedgerEventType.SHIPMENT_OUT
    case LotAdjustmentType.ADDITION:
      return LotLedgerEventType.ADDITION
    case LotAdjustmentType.COUNT_CORRECTION:
      return LotLedgerEventType.COUNT_CORRECTION
    case LotAdjustmentType.OTHER:
    default:
      return LotLedgerEventType.ADJUSTMENT
  }
}

export async function recordLotLedgerEvent(
  {
    organizationId,
    lotId,
    eventType,
    eventDate,
    headChange,
    headAfter,
    notes,
    createdById,
    relatedLotId,
    relatedOwnerId,
    relatedPenId,
    metadata,
  }: RecordLotLedgerEventInput,
  client: LedgerClient = prisma,
) {
  await client.lotEventLedger.create({
    data: {
      organizationId,
      lotId,
      eventType,
      eventDate: startOfDay(eventDate),
      headChange,
      headAfter,
      notes: notes ?? null,
      createdById: createdById ?? null,
      relatedLotId: relatedLotId ?? null,
      relatedOwnerId: relatedOwnerId ?? null,
      relatedPenId: relatedPenId ?? null,
      metadata,
    },
  })
}

export function calculateHeadDaysFromLedger({
  arrivalDate,
  exitDate,
  currentHeadCount,
  monthStart,
  monthEnd,
  ledgerEvents,
}: {
  arrivalDate: Date
  exitDate: Date | null
  currentHeadCount: number
  monthStart: Date
  monthEnd: Date
  ledgerEvents: LotLedgerSnapshot[]
}) {
  const today = startOfDay(new Date())
  const arrival = startOfDay(arrivalDate)
  const finalDate = startOfDay(exitDate ?? today)
  const effectiveEndExclusive = new Date(finalDate.getTime() + DAY_IN_MS)
  const rangeStart = startOfDay(new Date(Math.max(arrival.getTime(), monthStart.getTime())))
  const rangeEnd = new Date(Math.min(effectiveEndExclusive.getTime(), monthEnd.getTime()))

  if (rangeEnd <= rangeStart) return 0

  const sortedEvents = [...ledgerEvents]
    .map((event) => ({
      eventDate: startOfDay(event.eventDate),
      headChange: event.headChange,
      headAfter: event.headAfter,
    }))
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())

  if (sortedEvents.length === 0) {
    const days = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY_IN_MS)
    return days * currentHeadCount
  }

  const priorEvent = [...sortedEvents].reverse().find((event) => event.eventDate.getTime() < rangeStart.getTime())
  const firstInRangeEvent = sortedEvents.find((event) => event.eventDate.getTime() >= rangeStart.getTime())

  let currentCount =
    priorEvent?.headAfter ??
    (arrival.getTime() < rangeStart.getTime() && firstInRangeEvent
      ? firstInRangeEvent.headAfter - firstInRangeEvent.headChange
      : 0)

  if (!Number.isFinite(currentCount) || currentCount < 0) {
    currentCount = 0
  }

  let cursor = rangeStart.getTime()
  let headDays = 0

  for (const event of sortedEvents) {
    const eventTime = event.eventDate.getTime()
    if (eventTime < rangeStart.getTime()) continue
    if (eventTime >= rangeEnd.getTime()) break

    if (eventTime > cursor && currentCount > 0) {
      const days = Math.ceil((eventTime - cursor) / DAY_IN_MS)
      headDays += days * currentCount
    }

    currentCount = event.headAfter
    cursor = eventTime
  }

  if (rangeEnd.getTime() > cursor && currentCount > 0) {
    const days = Math.ceil((rangeEnd.getTime() - cursor) / DAY_IN_MS)
    headDays += days * currentCount
  }

  return headDays
}
