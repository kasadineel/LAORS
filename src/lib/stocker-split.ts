import { LotLedgerEventType, Prisma, StockerActivityType } from "@prisma/client"
import { logStockerActivity } from "@/lib/stocker-activity"
import { recordLotLedgerEvent } from "@/lib/stocker-ledger"
import { prisma } from "@/lib/prisma"
import { mergeLotWeightSnapshot, splitLotWeightSnapshot } from "@/lib/stocker-weights"

export const SPLIT_TARGET_MODE = {
  NEW: "new",
  EXISTING: "existing",
} as const

export type SplitTargetMode = (typeof SPLIT_TARGET_MODE)[keyof typeof SPLIT_TARGET_MODE]

type ExecuteLotSplitInput = {
  organizationId: string
  createdByUserId: string
  sourceLotId: string
  splitQuantity: number
  destinationOwnerId: string
  destinationPenId: string
  splitDate: Date
  notes?: string | null
  targetMode: SplitTargetMode
  destinationLotId?: string | null
}

type ExecuteLotSplitResult =
  | { kind: "move"; destinationLotId: string }
  | { kind: "split-new"; destinationLotId: string }
  | { kind: "split-existing"; destinationLotId: string }
  | null

function normalizeNotes(value?: string | null) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export async function executeLotSplit({
  organizationId,
  createdByUserId,
  sourceLotId,
  splitQuantity,
  destinationOwnerId,
  destinationPenId,
  splitDate,
  notes,
  targetMode,
  destinationLotId,
}: ExecuteLotSplitInput): Promise<ExecuteLotSplitResult> {
  if (!Number.isInteger(splitQuantity) || splitQuantity <= 0) return null
  if (!destinationOwnerId || !destinationPenId) return null
  if (targetMode !== SPLIT_TARGET_MODE.NEW && targetMode !== SPLIT_TARGET_MODE.EXISTING) return null

  return prisma.$transaction(async (tx) => {
    const sourceLot = await tx.lot.findFirst({
      where: {
        id: sourceLotId,
        organizationId,
      },
      select: {
        id: true,
        ownerId: true,
        penId: true,
        headCount: true,
        inHeadCount: true,
        inTotalWeight: true,
        exitDate: true,
        notes: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
      },
    })

    if (!sourceLot || sourceLot.exitDate) return null
    if (splitQuantity > sourceLot.headCount) return null

    const [destinationOwner, destinationPen] = await Promise.all([
      tx.owner.findFirst({
        where: { id: destinationOwnerId, organizationId },
        select: { id: true, name: true },
      }),
      tx.pen.findFirst({
        where: { id: destinationPenId, organizationId },
        select: { id: true, name: true },
      }),
    ])

    if (!destinationOwner || !destinationPen) return null

    const normalizedNotes = normalizeNotes(notes)

    const isWholeLotMove =
      splitQuantity === sourceLot.headCount &&
      targetMode === SPLIT_TARGET_MODE.NEW &&
      destinationOwnerId === sourceLot.ownerId &&
      destinationPenId !== sourceLot.penId

    if (isWholeLotMove) {
      await tx.lotMove.create({
        data: {
          lotId: sourceLot.id,
          fromPenId: sourceLot.penId,
          toPenId: destinationPenId,
          moveDate: splitDate,
          headCountMoved: splitQuantity,
        },
      })

      await tx.lot.update({
        where: { id: sourceLot.id },
        data: { penId: destinationPenId },
      })

      await recordLotLedgerEvent(
        {
          organizationId,
          lotId: sourceLot.id,
          eventType: LotLedgerEventType.MOVE,
          eventDate: splitDate,
          headChange: 0,
          headAfter: sourceLot.headCount,
          notes: normalizedNotes,
          createdById: createdByUserId,
          relatedPenId: destinationPenId,
          metadata: {
            ownerId: sourceLot.ownerId,
            ownerName: sourceLot.owner.name,
            fromPenId: sourceLot.penId,
            fromPenName: sourceLot.pen.name,
            toPenId: destinationPenId,
            toPenName: destinationPen.name,
            headCountMoved: splitQuantity,
            moveDate: splitDate.toISOString(),
            notes: normalizedNotes,
          },
        },
        tx,
      )

      await logStockerActivity(
        {
          organizationId,
          type: StockerActivityType.MOVE,
          message: `${splitQuantity} head moved for ${sourceLot.owner.name} from ${sourceLot.pen.name} to ${destinationPen.name}.`,
          metadata: {
            lotId: sourceLot.id,
            ownerId: sourceLot.ownerId,
            ownerName: sourceLot.owner.name,
            fromPenId: sourceLot.penId,
            fromPenName: sourceLot.pen.name,
            toPenId: destinationPenId,
            toPenName: destinationPen.name,
            headCountMoved: splitQuantity,
            moveDate: splitDate.toISOString(),
            notes: normalizedNotes,
          },
          createdByUserId,
        },
        tx,
      )

      return { kind: "move", destinationLotId: sourceLot.id }
    }

    if (splitQuantity >= sourceLot.headCount) return null

    const sourceWeightSnapshot = splitLotWeightSnapshot({
      currentHeadCount: sourceLot.headCount,
      movedCount: splitQuantity,
      inTotalWeight: sourceLot.inTotalWeight,
    })

    await tx.lot.update({
      where: { id: sourceLot.id },
      data: {
        headCount: sourceLot.headCount - splitQuantity,
        inHeadCount: sourceWeightSnapshot.sourceInHeadCount,
        inTotalWeight: sourceWeightSnapshot.sourceInTotalWeight,
      },
    })

    const sourceHeadAfter = sourceLot.headCount - splitQuantity

    await tx.lotMove.create({
      data: {
        lotId: sourceLot.id,
        fromPenId: sourceLot.penId,
        toPenId: destinationPenId,
        moveDate: splitDate,
        headCountMoved: splitQuantity,
      },
    })

    if (targetMode === SPLIT_TARGET_MODE.NEW) {
      const splitLot = await tx.lot.create({
        data: {
          organizationId,
          ownerId: destinationOwnerId,
          penId: destinationPenId,
          headCount: splitQuantity,
          inHeadCount: sourceWeightSnapshot.newInHeadCount,
          inTotalWeight: sourceWeightSnapshot.newInTotalWeight,
          arrivalDate: splitDate,
          notes: normalizedNotes,
        },
      })

      await recordLotLedgerEvent(
        {
          organizationId,
          lotId: sourceLot.id,
          eventType: LotLedgerEventType.SPLIT_OUT,
          eventDate: splitDate,
          headChange: -splitQuantity,
          headAfter: sourceHeadAfter,
          notes: normalizedNotes,
          createdById: createdByUserId,
          relatedLotId: splitLot.id,
          relatedOwnerId: destinationOwnerId,
          relatedPenId: destinationPenId,
          metadata: {
            sourceOwnerId: sourceLot.ownerId,
            sourceOwnerName: sourceLot.owner.name,
            destinationOwnerId,
            destinationOwnerName: destinationOwner.name,
            fromPenId: sourceLot.penId,
            fromPenName: sourceLot.pen.name,
            toPenId: destinationPenId,
            toPenName: destinationPen.name,
            headCountMoved: splitQuantity,
            remainingHeadCount: sourceHeadAfter,
            splitDate: splitDate.toISOString(),
            splitTargetMode: SPLIT_TARGET_MODE.NEW,
          },
        },
        tx,
      )

      await recordLotLedgerEvent(
        {
          organizationId,
          lotId: splitLot.id,
          eventType: LotLedgerEventType.SPLIT_IN,
          eventDate: splitDate,
          headChange: splitQuantity,
          headAfter: splitQuantity,
          notes: normalizedNotes,
          createdById: createdByUserId,
          relatedLotId: sourceLot.id,
          relatedOwnerId: sourceLot.ownerId,
          relatedPenId: sourceLot.penId,
          metadata: {
            sourceLotId: sourceLot.id,
            sourceOwnerId: sourceLot.ownerId,
            sourceOwnerName: sourceLot.owner.name,
            destinationOwnerId,
            destinationOwnerName: destinationOwner.name,
            fromPenId: sourceLot.penId,
            fromPenName: sourceLot.pen.name,
            toPenId: destinationPenId,
            toPenName: destinationPen.name,
            headCountMoved: splitQuantity,
            splitDate: splitDate.toISOString(),
            splitTargetMode: SPLIT_TARGET_MODE.NEW,
          },
        },
        tx,
      )

      await logStockerActivity(
        {
          organizationId,
          type: StockerActivityType.SPLIT,
          message: `Split ${splitQuantity} head from ${sourceLot.owner.name} to ${destinationOwner.name} in ${destinationPen.name}.`,
          metadata: {
            sourceLotId: sourceLot.id,
            newLotId: splitLot.id,
            destinationLotId: splitLot.id,
            sourceOwnerId: sourceLot.ownerId,
            ownerId: sourceLot.ownerId,
            ownerName: sourceLot.owner.name,
            destinationOwnerId,
            destinationOwnerName: destinationOwner.name,
            fromPenId: sourceLot.penId,
            fromPenName: sourceLot.pen.name,
            toPenId: destinationPenId,
            toPenName: destinationPen.name,
            headCountMoved: splitQuantity,
            remainingHeadCount: sourceLot.headCount - splitQuantity,
            splitDate: splitDate.toISOString(),
            splitTargetMode: SPLIT_TARGET_MODE.NEW,
            notes: normalizedNotes,
          } satisfies Prisma.InputJsonValue,
          createdByUserId,
        },
        tx,
      )

      return { kind: "split-new", destinationLotId: splitLot.id }
    }

    if (!destinationLotId) return null

    const existingDestinationLot = await tx.lot.findFirst({
      where: {
        id: destinationLotId,
        organizationId,
      },
      select: {
        id: true,
        ownerId: true,
        penId: true,
        headCount: true,
        inHeadCount: true,
        inTotalWeight: true,
        exitDate: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
      },
    })

    if (!existingDestinationLot || existingDestinationLot.exitDate) return null
    if (existingDestinationLot.id === sourceLot.id) return null
    if (existingDestinationLot.ownerId !== destinationOwnerId || existingDestinationLot.penId !== destinationPenId) {
      return null
    }

    const mergedWeightSnapshot = mergeLotWeightSnapshot({
      destinationHeadCount: existingDestinationLot.headCount,
      destinationInHeadCount: existingDestinationLot.inHeadCount,
      destinationInTotalWeight: existingDestinationLot.inTotalWeight,
      addedHeadCount: splitQuantity,
      addedInHeadCount: sourceWeightSnapshot.newInHeadCount,
      addedInTotalWeight: sourceWeightSnapshot.newInTotalWeight,
    })

    await tx.lot.update({
      where: { id: existingDestinationLot.id },
      data: {
        headCount: existingDestinationLot.headCount + splitQuantity,
        inHeadCount: mergedWeightSnapshot.inHeadCount,
        inTotalWeight: mergedWeightSnapshot.inTotalWeight,
      },
    })

    const destinationHeadAfter = existingDestinationLot.headCount + splitQuantity

    await recordLotLedgerEvent(
      {
        organizationId,
        lotId: sourceLot.id,
        eventType: LotLedgerEventType.SPLIT_OUT,
        eventDate: splitDate,
        headChange: -splitQuantity,
        headAfter: sourceHeadAfter,
        notes: normalizedNotes,
        createdById: createdByUserId,
        relatedLotId: existingDestinationLot.id,
        relatedOwnerId: destinationOwnerId,
        relatedPenId: destinationPenId,
        metadata: {
          sourceOwnerId: sourceLot.ownerId,
          sourceOwnerName: sourceLot.owner.name,
          destinationOwnerId,
          destinationOwnerName: existingDestinationLot.owner.name,
          fromPenId: sourceLot.penId,
          fromPenName: sourceLot.pen.name,
          toPenId: destinationPenId,
          toPenName: existingDestinationLot.pen.name,
          headCountMoved: splitQuantity,
          remainingHeadCount: sourceHeadAfter,
          destinationHeadCount: destinationHeadAfter,
          splitDate: splitDate.toISOString(),
          splitTargetMode: SPLIT_TARGET_MODE.EXISTING,
        },
      },
      tx,
    )

    await recordLotLedgerEvent(
      {
        organizationId,
        lotId: existingDestinationLot.id,
        eventType: LotLedgerEventType.SPLIT_IN,
        eventDate: splitDate,
        headChange: splitQuantity,
        headAfter: destinationHeadAfter,
        notes: normalizedNotes,
        createdById: createdByUserId,
        relatedLotId: sourceLot.id,
        relatedOwnerId: sourceLot.ownerId,
        relatedPenId: sourceLot.penId,
        metadata: {
          sourceLotId: sourceLot.id,
          sourceOwnerId: sourceLot.ownerId,
          sourceOwnerName: sourceLot.owner.name,
          destinationOwnerId,
          destinationOwnerName: existingDestinationLot.owner.name,
          fromPenId: sourceLot.penId,
          fromPenName: sourceLot.pen.name,
          toPenId: destinationPenId,
          toPenName: existingDestinationLot.pen.name,
          headCountMoved: splitQuantity,
          destinationHeadCount: destinationHeadAfter,
          splitDate: splitDate.toISOString(),
          splitTargetMode: SPLIT_TARGET_MODE.EXISTING,
        },
      },
      tx,
    )

    await logStockerActivity(
      {
        organizationId,
        type: StockerActivityType.SPLIT,
        message: `Added ${splitQuantity} split head from ${sourceLot.owner.name} into existing lot for ${existingDestinationLot.owner.name} in ${existingDestinationLot.pen.name}.`,
        metadata: {
          sourceLotId: sourceLot.id,
          destinationLotId: existingDestinationLot.id,
          sourceOwnerId: sourceLot.ownerId,
          ownerId: sourceLot.ownerId,
          ownerName: sourceLot.owner.name,
          destinationOwnerId,
          destinationOwnerName: existingDestinationLot.owner.name,
          fromPenId: sourceLot.penId,
          fromPenName: sourceLot.pen.name,
          toPenId: destinationPenId,
          toPenName: existingDestinationLot.pen.name,
          headCountMoved: splitQuantity,
          remainingHeadCount: sourceLot.headCount - splitQuantity,
          destinationHeadCount: existingDestinationLot.headCount + splitQuantity,
          splitDate: splitDate.toISOString(),
          splitTargetMode: SPLIT_TARGET_MODE.EXISTING,
          notes: normalizedNotes,
        } satisfies Prisma.InputJsonValue,
        createdByUserId,
      },
      tx,
    )

    return { kind: "split-existing", destinationLotId: existingDestinationLot.id }
  })
}
