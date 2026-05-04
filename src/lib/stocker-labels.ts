import {
  InvoiceLineSource,
  InvoiceStatus,
  LotAdjustmentDirection,
  LotAdjustmentType,
  LotLedgerEventType,
  StockerActivityType,
  type Prisma,
} from "@prisma/client"

type LotLabelInput = {
  nickname?: string | null
  ownerName?: string | null
  penName?: string | null
  arrivalDate?: Date | string | null
}

type StockerActivityMessageInput = {
  type?: StockerActivityType | null
  message: string
  metadata?: Prisma.JsonValue | null
}

function asMetadataRecord(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  return metadata as Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatShortDate(value: Date | string | null | undefined) {
  if (!value) return null

  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatTotalWeightLbs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not recorded"

  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  })} lbs`
}

export function calculateAverageWeight(totalWeight: number | null | undefined, headCount: number | null | undefined) {
  if (
    totalWeight === null ||
    totalWeight === undefined ||
    !Number.isFinite(totalWeight) ||
    headCount === null ||
    headCount === undefined ||
    !Number.isFinite(headCount) ||
    headCount <= 0
  ) {
    return null
  }

  return totalWeight / headCount
}

export function formatAverageWeightLbs(totalWeight: number | null | undefined, headCount: number | null | undefined) {
  const average = calculateAverageWeight(totalWeight, headCount)
  if (average === null) return "Not recorded"

  return `${average.toLocaleString(undefined, {
    maximumFractionDigits: average >= 100 ? 0 : 1,
  })} lbs`
}

export function formatLotLabel({ nickname, ownerName, penName, arrivalDate }: LotLabelInput) {
  if (nickname?.trim()) return nickname.trim()

  const arrivalLabel = formatShortDate(arrivalDate)
  if (ownerName && penName && arrivalLabel) return `${ownerName} • ${penName} • ${arrivalLabel}`
  if (penName && arrivalLabel) return `${penName} • ${arrivalLabel}`
  if (ownerName && penName) return `${ownerName} • ${penName}`
  if (penName) return penName
  if (ownerName) return ownerName
  return "Open lot"
}

export function formatLotOptionLabel(input: LotLabelInput & { headCount?: number | null }) {
  const baseLabel = formatLotLabel(input)
  const headCount = input.headCount ?? null
  if (headCount === null) return baseLabel

  return `${baseLabel} • ${headCount} head`
}

export function getLotAdjustmentTypeLabel(type: LotAdjustmentType) {
  switch (type) {
    case LotAdjustmentType.DEATH_LOSS:
      return "Death loss"
    case LotAdjustmentType.OWNER_PICKUP:
      return "Owner pickup"
    case LotAdjustmentType.SHIPMENT_OUT:
      return "Shipment out"
    case LotAdjustmentType.ADDITION:
      return "Addition received"
    case LotAdjustmentType.COUNT_CORRECTION:
      return "Count correction"
    case LotAdjustmentType.OTHER:
    default:
      return "Other"
  }
}

export function getLotLedgerEventTypeLabel(type: LotLedgerEventType) {
  switch (type) {
    case LotLedgerEventType.INTAKE:
      return "Intake"
    case LotLedgerEventType.ADJUSTMENT:
      return "Adjustment"
    case LotLedgerEventType.SPLIT_OUT:
      return "Split out"
    case LotLedgerEventType.SPLIT_IN:
      return "Split in"
    case LotLedgerEventType.OWNER_PICKUP:
      return "Owner pickup"
    case LotLedgerEventType.DEATH_LOSS:
      return "Death loss"
    case LotLedgerEventType.ADDITION:
      return "Addition"
    case LotLedgerEventType.MOVE:
      return "Move"
    case LotLedgerEventType.CLOSE:
      return "Close"
    case LotLedgerEventType.SHIPMENT_OUT:
      return "Shipment out"
    case LotLedgerEventType.COUNT_CORRECTION:
      return "Count correction"
    default:
      return "Ledger event"
  }
}

export function getInvoiceStatusLabel(status: InvoiceStatus) {
  switch (status) {
    case InvoiceStatus.DRAFT:
      return "Draft"
    case InvoiceStatus.FINALIZED:
      return "Finalized"
    case InvoiceStatus.VOID:
      return "Void"
    default:
      return status
  }
}

export function getInvoiceLineSourceLabel(source: InvoiceLineSource) {
  switch (source) {
    case InvoiceLineSource.YARDAGE:
      return "Yardage"
    case InvoiceLineSource.FEED:
      return "Feed"
    case InvoiceLineSource.TREATMENT:
      return "Treatment"
    case InvoiceLineSource.MANUAL:
    default:
      return "Manual"
  }
}

export function formatLotLedgerEventMessage({
  eventType,
  headChange,
  metadata,
}: {
  eventType: LotLedgerEventType
  headChange: number
  metadata?: Prisma.JsonValue | null
}) {
  const data = asMetadataRecord(metadata)
  const ownerName = asString(data?.ownerName)
  const sourceOwnerName = asString(data?.sourceOwnerName) ?? ownerName
  const destinationOwnerName = asString(data?.destinationOwnerName)
  const penName = asString(data?.penName) ?? asString(data?.fromPenName)
  const toPenName = asString(data?.toPenName)
  const outHeadCount = asNumber(data?.outHeadCount)

  switch (eventType) {
    case LotLedgerEventType.INTAKE:
      if (headChange > 0 && ownerName && penName) {
        return `${headChange} head received for ${ownerName} into ${penName}.`
      }
      break
    case LotLedgerEventType.MOVE:
      if (sourceOwnerName && penName && toPenName) {
        return `${sourceOwnerName} moved from ${penName} to ${toPenName}.`
      }
      break
    case LotLedgerEventType.SPLIT_OUT:
      if (Math.abs(headChange) > 0 && sourceOwnerName && destinationOwnerName && toPenName) {
        return `Split ${Math.abs(headChange)} head from ${sourceOwnerName} to ${destinationOwnerName} in ${toPenName}.`
      }
      break
    case LotLedgerEventType.SPLIT_IN:
      if (headChange > 0 && destinationOwnerName && toPenName) {
        return `Received ${headChange} split head for ${destinationOwnerName} in ${toPenName}.`
      }
      break
    case LotLedgerEventType.OWNER_PICKUP:
    case LotLedgerEventType.DEATH_LOSS:
    case LotLedgerEventType.ADDITION:
    case LotLedgerEventType.COUNT_CORRECTION:
    case LotLedgerEventType.ADJUSTMENT:
    case LotLedgerEventType.SHIPMENT_OUT:
      if (headChange !== 0) {
        return `${headChange > 0 ? "+" : ""}${headChange} head · ${getLotLedgerEventTypeLabel(eventType)}`
      }
      break
    case LotLedgerEventType.CLOSE:
      if (outHeadCount !== null && ownerName && penName) {
        return `Closeout recorded for ${ownerName} in ${penName} with ${outHeadCount} head out.`
      }
      if (outHeadCount !== null) {
        return `Closed lot with ${outHeadCount} head out.`
      }
      return "Closed lot."
    default:
      break
  }

  if (headChange !== 0) {
    return `${headChange > 0 ? "+" : ""}${headChange} head · ${getLotLedgerEventTypeLabel(eventType)}`
  }

  return getLotLedgerEventTypeLabel(eventType)
}

export function formatStockerActivityMessage({ type, message, metadata }: StockerActivityMessageInput) {
  const data = asMetadataRecord(metadata)
  if (!data || !type) return message

  const ownerName = asString(data.ownerName)
  const penName = asString(data.penName)
  const toPenName = asString(data.toPenName)
  const medicine = asString(data.medicine)
  const headCount = asNumber(data.headCount)
  const headCountMoved = asNumber(data.headCountMoved)
  const quantity = asNumber(data.quantity)
  const total = asNumber(data.total)
  const outHeadCount = asNumber(data.outHeadCount)
  const outTotalWeight = asNumber(data.outTotalWeight)
  const typeValue = asString(data.type) as LotAdjustmentType | null
  const direction = asString(data.direction) as LotAdjustmentDirection | null
  const destinationOwnerName = asString(data.destinationOwnerName)
  const splitTargetMode = asString(data.splitTargetMode)

  switch (type) {
    case StockerActivityType.INTAKE:
      if (headCount !== null && ownerName && penName) {
        return `${headCount} head received for ${ownerName} into ${penName}.`
      }
      return message
    case StockerActivityType.MOVE:
      if (headCountMoved !== null && ownerName && penName && toPenName) {
        return `${headCountMoved} head moved for ${ownerName} from ${penName} to ${toPenName}.`
      }
      return message
    case StockerActivityType.SPLIT:
      if (
        headCountMoved !== null &&
        ownerName &&
        penName &&
        destinationOwnerName &&
        toPenName
      ) {
        if (splitTargetMode === "existing") {
          return `Added ${headCountMoved} split head from ${ownerName} in ${penName} into existing lot for ${destinationOwnerName} in ${toPenName}.`
        }

        return `Split ${headCountMoved} head from ${ownerName} in ${penName} to ${destinationOwnerName} in ${toPenName}.`
      }
      if (headCountMoved !== null && ownerName && penName && toPenName) {
        return `${headCountMoved} head split for ${ownerName} from ${penName} into ${toPenName}.`
      }
      return message
    case StockerActivityType.CLOSE_LOT:
      if (ownerName && penName && outHeadCount !== null) {
        return `Recorded closeout for ${formatLotLabel({ ownerName, penName })} with ${outHeadCount} head out${outTotalWeight !== null ? ` at ${formatTotalWeightLbs(outTotalWeight)}` : ""}.`
      }
      if (ownerName && penName && headCount !== null) {
        return `Recorded closeout for ${formatLotLabel({ ownerName, penName })} with ${headCount} head on lot.`
      }
      if (ownerName && penName) {
        return `Recorded closeout for ${formatLotLabel({ ownerName, penName })}.`
      }
      return message
    case StockerActivityType.TREATMENT:
      if (medicine && ownerName && penName) {
        return `Logged treatment ${medicine} for ${ownerName} in ${penName}.`
      }
      return message
    case StockerActivityType.INVOICE_CREATED:
      if (ownerName && total !== null) {
        return `Created invoice for ${ownerName} totaling $${total.toFixed(2)}.`
      }
      return message
    case StockerActivityType.LOT_ADJUSTMENT:
      if (quantity !== null && direction && typeValue && ownerName && penName) {
        return `Adjusted ${formatLotLabel({ ownerName, penName })}: ${direction === LotAdjustmentDirection.IN ? "+" : "-"}${quantity} head (${getLotAdjustmentTypeLabel(typeValue)}).`
      }
      return message
    default:
      return message
  }
}
