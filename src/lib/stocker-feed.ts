import { FeedEntryUnit, type Prisma } from "@prisma/client"
import { formatLotLabel } from "@/lib/stocker-labels"
import { prisma } from "@/lib/prisma"

const LBS_PER_TON = 2000

type FeedClient = typeof prisma | Prisma.TransactionClient

type FeedRangeInput = {
  organizationId: string
  monthStart: Date
  monthEnd: Date
  ownerId?: string
}

type FeedEntryAllocationPreviewInput = {
  organizationId: string
  penId: string
  entryDate: Date
}

type LotForAllocation = {
  id: string
  ownerId: string
  penId: string
  headCount: number
  arrivalDate: Date
  exitDate: Date | null
  owner: { name: string }
  pen: { name: string }
  ledgerEvents: Array<{
    eventDate: Date
    headAfter: number
    createdAt: Date
  }>
}

type RuleForAllocation = {
  id: string
  penId: string
  ownerId: string
  allocationPercent: number
  effectiveStartDate: Date
  effectiveEndDate: Date | null
}

type FeedEntryForAllocation = {
  id: string
  entryDate: Date
  amount: number
  costPerTonSnapshot: number
  totalCostSnapshot: number
  penId: string
  pen: { name: string }
  rationId: string
  ration: { name: string }
}

export type FeedAllocationRow = {
  entryId: string
  entryDate: Date
  penId: string
  penName: string
  rationId: string
  rationName: string
  ownerId: string
  ownerName: string
  lotId: string
  lotLabel: string
  allocatedLbs: number
  allocatedTons: number
  allocatedCost: number
  costPerTonSnapshot: number
  ownerAllocationPercent: number
}

type FeedEntrySummary = {
  entryId: string
  entryDate: Date
  penId: string
  penName: string
  activeOwnerIds: string[]
}

type UnallocatedFeedEntry = FeedEntrySummary & {
  reason: string
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
}

function roundAmount(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function poundsToTons(pounds: number) {
  return pounds / LBS_PER_TON
}

export function formatFeedLbs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0 lbs"
  return `${roundAmount(value, value >= 100 ? 0 : 1).toLocaleString()} lbs`
}

export function formatFeedTons(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0.00 tons"
  return `${roundAmount(value, 2).toFixed(2)} tons`
}

function isLotActiveOnDate(lot: LotForAllocation, targetDate: Date) {
  const day = startOfDay(targetDate)
  return lot.arrivalDate <= day && (!lot.exitDate || lot.exitDate >= day)
}

export function getLotHeadCountOnDate({
  arrivalDate,
  exitDate,
  currentHeadCount,
  targetDate,
  ledgerEvents,
}: {
  arrivalDate: Date
  exitDate: Date | null
  currentHeadCount: number
  targetDate: Date
  ledgerEvents: Array<{ eventDate: Date; headAfter: number }>
}) {
  const day = startOfDay(targetDate)
  if (arrivalDate > day) return 0
  if (exitDate && exitDate < day) return 0

  const latestEvent = [...ledgerEvents]
    .filter((event) => startOfDay(event.eventDate).getTime() <= day.getTime())
    .sort((a, b) => startOfDay(b.eventDate).getTime() - startOfDay(a.eventDate).getTime())[0]

  if (latestEvent) {
    return Math.max(latestEvent.headAfter, 0)
  }

  return Math.max(currentHeadCount, 0)
}

function getActiveRulesForPenOnDate(rules: RuleForAllocation[], penId: string, date: Date) {
  const day = startOfDay(date)
  const matching = rules
    .filter(
      (rule) =>
        rule.penId === penId &&
        rule.effectiveStartDate <= day &&
        (!rule.effectiveEndDate || rule.effectiveEndDate >= day),
    )
    .sort((a, b) => b.effectiveStartDate.getTime() - a.effectiveStartDate.getTime())

  const latestPerOwner = new Map<string, RuleForAllocation>()
  for (const rule of matching) {
    if (!latestPerOwner.has(rule.ownerId)) {
      latestPerOwner.set(rule.ownerId, rule)
    }
  }

  return Array.from(latestPerOwner.values())
}

function buildAllocationRowsForEntry({
  entry,
  activeLots,
  rules,
}: {
  entry: FeedEntryForAllocation
  activeLots: LotForAllocation[]
  rules: RuleForAllocation[]
}) {
  if (activeLots.length === 0) {
    return { rows: [] as FeedAllocationRow[], allocatable: false, reason: "No active lots in this pen for the entry date." }
  }

  const lotsWithCounts = activeLots
    .map((lot) => ({
      ...lot,
      headCountOnDate: getLotHeadCountOnDate({
        arrivalDate: lot.arrivalDate,
        exitDate: lot.exitDate,
        currentHeadCount: lot.headCount,
        targetDate: entry.entryDate,
        ledgerEvents: lot.ledgerEvents,
      }),
    }))
    .filter((lot) => lot.headCountOnDate > 0)

  if (lotsWithCounts.length === 0) {
    return { rows: [] as FeedAllocationRow[], allocatable: false, reason: "No positive head count was found for active lots in this pen on the entry date." }
  }

  const lotsByOwner = new Map<string, typeof lotsWithCounts>()
  for (const lot of lotsWithCounts) {
    const existing = lotsByOwner.get(lot.ownerId) ?? []
    existing.push(lot)
    lotsByOwner.set(lot.ownerId, existing)
  }

  const entryTons = poundsToTons(entry.amount)
  const rows: FeedAllocationRow[] = []

  if (lotsByOwner.size === 1) {
    const [ownerId, ownerLots] = Array.from(lotsByOwner.entries())[0]
    const owner = ownerLots[0]?.owner
    const ownerHeadCount = ownerLots.reduce((sum, lot) => sum + lot.headCountOnDate, 0)

    for (const lot of ownerLots) {
      const share = ownerHeadCount > 0 ? lot.headCountOnDate / ownerHeadCount : 0
      rows.push({
        entryId: entry.id,
        entryDate: entry.entryDate,
        penId: entry.penId,
        penName: entry.pen.name,
        rationId: entry.rationId,
        rationName: entry.ration.name,
        ownerId,
        ownerName: owner?.name ?? "Owner",
        lotId: lot.id,
        lotLabel: formatLotLabel({
          ownerName: lot.owner.name,
          penName: lot.pen.name,
          arrivalDate: lot.arrivalDate,
        }),
        allocatedLbs: roundAmount(entry.amount * share, 2),
        allocatedTons: roundAmount(entryTons * share, 4),
        allocatedCost: roundAmount(entry.totalCostSnapshot * share, 2),
        costPerTonSnapshot: entry.costPerTonSnapshot,
        ownerAllocationPercent: 100,
      })
    }

    return { rows, allocatable: true as const }
  }

  const activeRules = getActiveRulesForPenOnDate(rules, entry.penId, entry.entryDate)
  const ruleByOwner = new Map(activeRules.map((rule) => [rule.ownerId, rule]))
  const activeOwnerIds = Array.from(lotsByOwner.keys())
  const missingOwnerIds = activeOwnerIds.filter((ownerId) => !ruleByOwner.has(ownerId))

  if (missingOwnerIds.length > 0) {
    return {
      rows: [] as FeedAllocationRow[],
      allocatable: false,
      reason: "This pen has multiple owners on the feed date and is missing feed allocation rules.",
    }
  }

  const totalPercent = activeOwnerIds.reduce((sum, ownerId) => sum + (ruleByOwner.get(ownerId)?.allocationPercent ?? 0), 0)
  if (Math.abs(totalPercent - 100) > 0.25) {
    return {
      rows: [] as FeedAllocationRow[],
      allocatable: false,
      reason: "Allocation rules for this shared pen do not total 100%.",
    }
  }

  for (const ownerId of activeOwnerIds) {
    const ownerLots = lotsByOwner.get(ownerId) ?? []
    const ownerPercent = (ruleByOwner.get(ownerId)?.allocationPercent ?? 0) / 100
    const ownerHeadCount = ownerLots.reduce((sum, lot) => sum + lot.headCountOnDate, 0)

    if (ownerHeadCount <= 0) continue

    for (const lot of ownerLots) {
      const lotShareWithinOwner = lot.headCountOnDate / ownerHeadCount
      const totalShare = ownerPercent * lotShareWithinOwner
      rows.push({
        entryId: entry.id,
        entryDate: entry.entryDate,
        penId: entry.penId,
        penName: entry.pen.name,
        rationId: entry.rationId,
        rationName: entry.ration.name,
        ownerId,
        ownerName: lot.owner.name,
        lotId: lot.id,
        lotLabel: formatLotLabel({
          ownerName: lot.owner.name,
          penName: lot.pen.name,
          arrivalDate: lot.arrivalDate,
        }),
        allocatedLbs: roundAmount(entry.amount * totalShare, 2),
        allocatedTons: roundAmount(entryTons * totalShare, 4),
        allocatedCost: roundAmount(entry.totalCostSnapshot * totalShare, 2),
        costPerTonSnapshot: entry.costPerTonSnapshot,
        ownerAllocationPercent: roundAmount(ownerPercent * 100, 2),
      })
    }
  }

  return { rows, allocatable: rows.length > 0, reason: rows.length > 0 ? null : "Unable to build allocation rows." }
}

export async function previewFeedAllocationForEntry(
  { organizationId, penId, entryDate }: FeedEntryAllocationPreviewInput,
  client: FeedClient = prisma,
) {
  const rangeEnd = endOfDay(entryDate)
  const [lots, rules] = await Promise.all([
    client.lot.findMany({
      where: {
        organizationId,
        penId,
        arrivalDate: { lt: rangeEnd },
        OR: [{ exitDate: null }, { exitDate: { gte: startOfDay(entryDate) } }],
      },
      select: {
        id: true,
        ownerId: true,
        penId: true,
        headCount: true,
        arrivalDate: true,
        exitDate: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
        ledgerEvents: {
          where: { eventDate: { lt: rangeEnd } },
          orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
          select: {
            eventDate: true,
            headAfter: true,
            createdAt: true,
          },
        },
      },
    }),
    client.feedAllocationRule.findMany({
      where: {
        organizationId,
        penId,
        effectiveStartDate: { lt: rangeEnd },
        OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: startOfDay(entryDate) } }],
      },
      select: {
        id: true,
        penId: true,
        ownerId: true,
        allocationPercent: true,
        effectiveStartDate: true,
        effectiveEndDate: true,
      },
    }),
  ])

  const activeLots = lots.filter((lot) => isLotActiveOnDate(lot, entryDate))
  const activeRules = getActiveRulesForPenOnDate(rules, penId, entryDate)

  if (activeLots.length === 0) {
    return { allocatable: false, reason: "No active lots are in this pen on the selected feed date." }
  }

  const ownerIds = new Set(activeLots.map((lot) => lot.ownerId))
  if (ownerIds.size === 1) {
    return { allocatable: true, reason: null }
  }

  const totalPercent = activeRules
    .filter((rule) => ownerIds.has(rule.ownerId))
    .reduce((sum, rule) => sum + rule.allocationPercent, 0)
  const hasAllOwners = Array.from(ownerIds).every((ownerId) => activeRules.some((rule) => rule.ownerId === ownerId))

  if (!hasAllOwners) {
    return { allocatable: false, reason: "Shared pens require a feed allocation rule for each active owner." }
  }

  if (Math.abs(totalPercent - 100) > 0.25) {
    return { allocatable: false, reason: "Shared pen allocation rules must total 100%." }
  }

  return { allocatable: true, reason: null }
}

export async function getFeedAllocationRowsForRange(
  { organizationId, monthStart, monthEnd, ownerId }: FeedRangeInput,
  client: FeedClient = prisma,
) {
  const [entries, lots, rules] = await Promise.all([
    client.feedEntry.findMany({
      where: {
        organizationId,
        entryDate: { gte: monthStart, lt: monthEnd },
      },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        entryDate: true,
        amount: true,
        costPerTonSnapshot: true,
        totalCostSnapshot: true,
        penId: true,
        pen: { select: { name: true } },
        rationId: true,
        ration: { select: { name: true } },
      },
    }),
    client.lot.findMany({
      where: {
        organizationId,
        arrivalDate: { lt: monthEnd },
        OR: [{ exitDate: null }, { exitDate: { gte: monthStart } }],
      },
      select: {
        id: true,
        ownerId: true,
        penId: true,
        headCount: true,
        arrivalDate: true,
        exitDate: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
        ledgerEvents: {
          where: { eventDate: { lt: monthEnd } },
          orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
          select: {
            eventDate: true,
            headAfter: true,
            createdAt: true,
          },
        },
      },
    }),
    client.feedAllocationRule.findMany({
      where: {
        organizationId,
        effectiveStartDate: { lt: monthEnd },
        OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: monthStart } }],
      },
      select: {
        id: true,
        penId: true,
        ownerId: true,
        allocationPercent: true,
        effectiveStartDate: true,
        effectiveEndDate: true,
      },
    }),
  ])

  const rows: FeedAllocationRow[] = []
  const entrySummaries: FeedEntrySummary[] = []
  const unallocatedEntries: UnallocatedFeedEntry[] = []

  for (const entry of entries) {
    const entryLots = lots.filter((lot) => lot.penId === entry.penId && isLotActiveOnDate(lot, entry.entryDate))
    const activeOwnerIds = Array.from(new Set(entryLots.map((lot) => lot.ownerId)))
    entrySummaries.push({
      entryId: entry.id,
      entryDate: entry.entryDate,
      penId: entry.penId,
      penName: entry.pen.name,
      activeOwnerIds,
    })
    const allocation = buildAllocationRowsForEntry({
      entry,
      activeLots: entryLots,
      rules,
    })

    if (!allocation.allocatable) {
      unallocatedEntries.push({
        entryId: entry.id,
        entryDate: entry.entryDate,
        penId: entry.penId,
        penName: entry.pen.name,
        activeOwnerIds,
        reason: allocation.reason ?? "Unallocated feed entry.",
      })
      continue
    }

    rows.push(...allocation.rows)
  }

  const filteredRows = ownerId ? rows.filter((row) => row.ownerId === ownerId) : rows

  return {
    rows: filteredRows,
    unallocatedEntries,
    entrySummaries,
  }
}

export async function getOwnerFeedSummary({
  organizationId,
  ownerId,
  monthStart,
  monthEnd,
}: FeedRangeInput & { ownerId: string }) {
  const { rows, unallocatedEntries, entrySummaries } = await getFeedAllocationRowsForRange({
    organizationId,
    ownerId,
    monthStart,
    monthEnd,
  })

  const totalLbs = roundAmount(rows.reduce((sum, row) => sum + row.allocatedLbs, 0), 2)
  const totalTons = roundAmount(rows.reduce((sum, row) => sum + row.allocatedTons, 0), 4)
  const totalCost = roundAmount(rows.reduce((sum, row) => sum + row.allocatedCost, 0), 2)
  const averageCostPerTon = totalTons > 0 ? roundAmount(totalCost / totalTons, 2) : 0
  const allocatedEntryCount = new Set(rows.map((row) => row.entryId)).size
  const relevantEntrySummaries = entrySummaries.filter((entry) => entry.activeOwnerIds.includes(ownerId))
  const relevantUnallocatedEntries = unallocatedEntries.filter((entry) => entry.activeOwnerIds.includes(ownerId))

  const byLot = Array.from(
    rows.reduce((map, row) => {
      const key = `${row.ownerId}:${row.lotId}`
      const existing = map.get(key) ?? {
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        lotId: row.lotId,
        lotLabel: row.lotLabel,
        totalLbs: 0,
        totalTons: 0,
        totalCost: 0,
      }

      existing.totalLbs = roundAmount(existing.totalLbs + row.allocatedLbs, 2)
      existing.totalTons = roundAmount(existing.totalTons + row.allocatedTons, 4)
      existing.totalCost = roundAmount(existing.totalCost + row.allocatedCost, 2)
      map.set(key, existing)
      return map
    }, new Map<string, {
      ownerId: string
      ownerName: string
      lotId: string
      lotLabel: string
      totalLbs: number
      totalTons: number
      totalCost: number
    }>())
      .values(),
  ).sort((a, b) => a.lotLabel.localeCompare(b.lotLabel))

  return {
    totalLbs,
    totalTons,
    totalCost,
    averageCostPerTon,
    organizationEntryCount: entrySummaries.length,
    relevantEntryCount: relevantEntrySummaries.length,
    allocatedEntryCount,
    allocations: rows,
    lotSummaries: byLot,
    unallocatedEntries: relevantUnallocatedEntries,
  }
}

export async function getMonthlyFeedSummary({
  organizationId,
  monthStart,
  monthEnd,
}: FeedRangeInput) {
  const { rows, unallocatedEntries } = await getFeedAllocationRowsForRange({
    organizationId,
    monthStart,
    monthEnd,
  })

  const groupedRows = Array.from(
    rows.reduce((map, row) => {
      const key = `${row.ownerId}:${row.lotId}`
      const existing = map.get(key) ?? {
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        lotId: row.lotId,
        lotLabel: row.lotLabel,
        totalLbs: 0,
        totalTons: 0,
        totalCost: 0,
      }

      existing.totalLbs = roundAmount(existing.totalLbs + row.allocatedLbs, 2)
      existing.totalTons = roundAmount(existing.totalTons + row.allocatedTons, 4)
      existing.totalCost = roundAmount(existing.totalCost + row.allocatedCost, 2)
      map.set(key, existing)
      return map
    }, new Map<string, {
      ownerId: string
      ownerName: string
      lotId: string
      lotLabel: string
      totalLbs: number
      totalTons: number
      totalCost: number
    }>())
      .values(),
  ).sort((a, b) => {
    if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName)
    return a.lotLabel.localeCompare(b.lotLabel)
  })

  return {
    rows: groupedRows,
    totals: {
      totalLbs: roundAmount(groupedRows.reduce((sum, row) => sum + row.totalLbs, 0), 2),
      totalTons: roundAmount(groupedRows.reduce((sum, row) => sum + row.totalTons, 0), 4),
      totalCost: roundAmount(groupedRows.reduce((sum, row) => sum + row.totalCost, 0), 2),
    },
    unallocatedEntries,
  }
}

export function getFeedEntryTotalCostSnapshot(amountLbs: number, costPerTon: number) {
  return roundAmount(poundsToTons(amountLbs) * costPerTon, 2)
}

export function getFeedEntryUnitLabel(unit: FeedEntryUnit) {
  switch (unit) {
    case FeedEntryUnit.LBS:
    default:
      return "lbs"
  }
}
