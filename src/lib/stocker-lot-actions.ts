import {
  LotAdjustmentDirection,
  LotAdjustmentType,
  LotLedgerEventType,
  Prisma,
  StockerActivityType,
} from "@prisma/client"
import { logStockerActivity } from "@/lib/stocker-activity"
import { formatLotLabel, formatTotalWeightLbs, getLotAdjustmentTypeLabel } from "@/lib/stocker-labels"
import { getLotLedgerEventTypeForAdjustment, recordLotLedgerEvent } from "@/lib/stocker-ledger"
import { prisma } from "@/lib/prisma"

type LotActionClient = typeof prisma | Prisma.TransactionClient

type CloseStockerLotInput = {
  organizationId: string
  lotId: string
  exitDate: Date
  outHeadCount: number | null
  outTotalWeight: number | null
  createdByUserId: string
}

type AdjustStockerLotHeadCountInput = {
  organizationId: string
  lotId: string
  adjustmentType: LotAdjustmentType
  quantity: number
  adjustmentDate: Date
  requestedDirection?: LotAdjustmentDirection | null
  notes?: string | null
  createdByUserId: string
}

type UpdateStockerLotRecordInput = {
  organizationId: string
  lotId: string
  arrivalDate: Date
  inTotalWeight: number | null
  exitDate: Date | null
  outHeadCount: number | null
  outTotalWeight: number | null
  notes?: string | null
}

export async function closeStockerLot(
  { organizationId, lotId, exitDate, outHeadCount, outTotalWeight, createdByUserId }: CloseStockerLotInput,
  client: LotActionClient = prisma,
) {
  const lot = await client.lot.findFirst({
    where: {
      id: lotId,
      organizationId,
    },
    select: {
      id: true,
      headCount: true,
      inHeadCount: true,
      inTotalWeight: true,
      exitDate: true,
      owner: { select: { name: true } },
      pen: { select: { name: true } },
    },
  })

  if (!lot) return null
  if (lot.exitDate) {
    return {
      lotId: lot.id,
      ownerName: lot.owner.name,
      penName: lot.pen.name,
      outHeadCount: lot.headCount,
      alreadyClosed: true,
    }
  }

  const effectiveOutHeadCount = outHeadCount ?? lot.headCount
  if (effectiveOutHeadCount > lot.headCount || effectiveOutHeadCount <= 0) return null

  await client.lot.updateMany({
    where: {
      id: lotId,
      organizationId,
    },
    data: {
      exitDate,
      outHeadCount: effectiveOutHeadCount,
      outTotalWeight,
    },
  })

  await recordLotLedgerEvent(
    {
      organizationId,
      lotId: lot.id,
      eventType: LotLedgerEventType.CLOSE,
      eventDate: exitDate,
      headChange: 0,
      headAfter: lot.headCount,
      createdById: createdByUserId,
      metadata: {
        headCount: lot.headCount,
        inHeadCount: lot.inHeadCount ?? lot.headCount,
        inTotalWeight: lot.inTotalWeight,
        outHeadCount: effectiveOutHeadCount,
        outTotalWeight,
        ownerName: lot.owner.name,
        penName: lot.pen.name,
        exitDate: exitDate.toISOString(),
      },
    },
    client,
  )

  await logStockerActivity(
    {
      organizationId,
      type: StockerActivityType.CLOSE_LOT,
      message: `Recorded closeout for ${formatLotLabel({ ownerName: lot.owner.name, penName: lot.pen.name })} with ${effectiveOutHeadCount} head out${outTotalWeight !== null ? ` at ${formatTotalWeightLbs(outTotalWeight)}` : ""}.`,
      metadata: {
        lotId: lot.id,
        headCount: lot.headCount,
        inHeadCount: lot.inHeadCount ?? lot.headCount,
        inTotalWeight: lot.inTotalWeight,
        outHeadCount: effectiveOutHeadCount,
        outTotalWeight,
        ownerName: lot.owner.name,
        penName: lot.pen.name,
        exitDate: exitDate.toISOString(),
      },
      createdByUserId,
    },
    client,
  )

  return {
    lotId: lot.id,
    ownerName: lot.owner.name,
    penName: lot.pen.name,
    outHeadCount: effectiveOutHeadCount,
    alreadyClosed: false,
  }
}

export function resolveLotAdjustmentDirection(
  type: LotAdjustmentType,
  requestedDirection?: LotAdjustmentDirection | null,
) {
  if (
    type === LotAdjustmentType.DEATH_LOSS ||
    type === LotAdjustmentType.OWNER_PICKUP ||
    type === LotAdjustmentType.SHIPMENT_OUT
  ) {
    return LotAdjustmentDirection.OUT
  }

  if (type === LotAdjustmentType.ADDITION) {
    return LotAdjustmentDirection.IN
  }

  if (type === LotAdjustmentType.COUNT_CORRECTION || type === LotAdjustmentType.OTHER) {
    return requestedDirection ?? null
  }

  return null
}

export async function adjustStockerLotHeadCount(
  {
    organizationId,
    lotId,
    adjustmentType,
    quantity,
    adjustmentDate,
    requestedDirection,
    notes,
    createdByUserId,
  }: AdjustStockerLotHeadCountInput,
  client: LotActionClient = prisma,
) {
  if (!Number.isInteger(quantity) || quantity <= 0) return null

  const direction = resolveLotAdjustmentDirection(adjustmentType, requestedDirection)
  if (!direction) return null

  const lot = await client.lot.findFirst({
    where: {
      id: lotId,
      organizationId,
    },
    select: {
      id: true,
      headCount: true,
      exitDate: true,
      owner: { select: { name: true } },
      pen: { select: { name: true } },
    },
  })

  if (!lot || lot.exitDate) return null

  const nextHeadCount =
    direction === LotAdjustmentDirection.IN ? lot.headCount + quantity : lot.headCount - quantity

  if (nextHeadCount < 0 || (direction === LotAdjustmentDirection.OUT && quantity > lot.headCount)) return null

  await client.lotAdjustment.create({
    data: {
      organizationId,
      lotId: lot.id,
      type: adjustmentType,
      direction,
      quantity,
      adjustmentDate,
      notes: notes ?? null,
      createdById: createdByUserId,
    },
  })

  await client.lot.update({
    where: { id: lot.id },
    data: { headCount: nextHeadCount },
  })

  await recordLotLedgerEvent(
    {
      organizationId,
      lotId: lot.id,
      eventType: getLotLedgerEventTypeForAdjustment(adjustmentType),
      eventDate: adjustmentDate,
      headChange: direction === LotAdjustmentDirection.IN ? quantity : -quantity,
      headAfter: nextHeadCount,
      notes: notes ?? null,
      createdById: createdByUserId,
      metadata: {
        ownerName: lot.owner.name,
        penName: lot.pen.name,
        type: adjustmentType,
        direction,
        quantity,
        previousHeadCount: lot.headCount,
        currentHeadCount: nextHeadCount,
        adjustmentDate: adjustmentDate.toISOString(),
        notes: notes ?? null,
      },
    },
    client,
  )

  await logStockerActivity(
    {
      organizationId,
      type: StockerActivityType.LOT_ADJUSTMENT,
      message: `Adjusted ${formatLotLabel({ ownerName: lot.owner.name, penName: lot.pen.name })}: ${direction === LotAdjustmentDirection.IN ? "+" : "-"}${quantity} head for ${getLotAdjustmentTypeLabel(adjustmentType).toLowerCase()}.`,
      metadata: {
        lotId: lot.id,
        ownerName: lot.owner.name,
        penName: lot.pen.name,
        type: adjustmentType,
        direction,
        quantity,
        previousHeadCount: lot.headCount,
        currentHeadCount: nextHeadCount,
        adjustmentDate: adjustmentDate.toISOString(),
        notes: notes ?? null,
      },
      createdByUserId,
    },
    client,
  )

  return {
    lotId: lot.id,
    ownerName: lot.owner.name,
    penName: lot.pen.name,
    previousHeadCount: lot.headCount,
    currentHeadCount: nextHeadCount,
    direction,
  }
}

export async function updateStockerLotRecord(
  {
    organizationId,
    lotId,
    arrivalDate,
    inTotalWeight,
    exitDate,
    outHeadCount,
    outTotalWeight,
    notes,
  }: UpdateStockerLotRecordInput,
  client: LotActionClient = prisma,
) {
  const existingLot = await client.lot.findFirst({
    where: {
      id: lotId,
      organizationId,
    },
    select: {
      id: true,
      headCount: true,
      inHeadCount: true,
    },
  })

  if (!existingLot) return null
  if (outHeadCount !== null && (!Number.isInteger(outHeadCount) || outHeadCount <= 0 || outHeadCount > existingLot.headCount)) {
    return null
  }

  await client.lot.update({
    where: { id: existingLot.id },
    data: {
      inHeadCount: inTotalWeight === null ? null : existingLot.inHeadCount ?? existingLot.headCount,
      inTotalWeight,
      outHeadCount,
      outTotalWeight,
      arrivalDate,
      exitDate,
      notes: notes ?? null,
    },
  })

  return { lotId: existingLot.id }
}
