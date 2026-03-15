import { InvoiceLineSource, InvoiceStatus, MedicineBillingMode } from "@prisma/client"
import { getOwnerFeedSummary } from "@/lib/stocker-feed"
import { prisma } from "@/lib/prisma"
import { getMonthWindow } from "@/lib/stocker"
import { calculateHeadDaysFromLedger, getBillingMonthValue } from "@/lib/stocker-ledger"

type OwnerFinancialSummaryInput = {
  organizationId: string
  ownerId: string
  monthValue?: string
}

type DraftInvoiceLine = {
  quantity: number
  description: string
  weight: null
  price: number
  amount: number
  source: InvoiceLineSource
  generated: boolean
}

type InvoiceSummaryForWindowInput = {
  organizationId: string
  ownerId?: string
  monthStart: Date
  monthEnd: Date
  monthValue: string
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundQuantity(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export async function getInvoiceSummaryForWindow({
  organizationId,
  ownerId,
  monthStart,
  monthEnd,
  monthValue,
}: InvoiceSummaryForWindowInput) {
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      ...(ownerId ? { ownerId } : null),
      status: { not: InvoiceStatus.VOID },
      OR: [
        { billingMonth: monthValue },
        {
          billingMonth: null,
          date: { gte: monthStart, lt: monthEnd },
        },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      ownerId: true,
      total: true,
      date: true,
      billingMonth: true,
      status: true,
      finalizedAt: true,
    },
  })

  const invoiceTotal = roundMoney(invoices.reduce((sum, invoice) => sum + invoice.total, 0))
  const invoiceStatusCounts = invoices.reduce(
    (counts, invoice) => {
      if (invoice.status === InvoiceStatus.DRAFT) counts.draft += 1
      if (invoice.status === InvoiceStatus.FINALIZED) counts.finalized += 1
      return counts
    },
    { draft: 0, finalized: 0 },
  )
  const invoiceBillingMonthMatchCount = invoices.filter((invoice) => invoice.billingMonth === monthValue).length
  const invoiceDateFallbackCount = invoices.filter((invoice) => !invoice.billingMonth).length
  const monthlyInvoices = [...invoices].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === InvoiceStatus.DRAFT) return -1
      if (b.status === InvoiceStatus.DRAFT) return 1
      if (a.status === InvoiceStatus.FINALIZED) return -1
      if (b.status === InvoiceStatus.FINALIZED) return 1
    }

    return b.date.getTime() - a.date.getTime()
  })

  return {
    invoices,
    invoiceTotal,
    invoiceCount: invoices.length,
    invoiceStatusCounts,
    invoiceBillingMonthMatchCount,
    invoiceDateFallbackCount,
    monthlyInvoices,
    existingInvoice: monthlyInvoices[0] ?? null,
  }
}

export function calculateTreatmentChargeWithMarkup({
  billableAmount,
  billingMode,
  medicineMarkupPercent,
}: {
  billableAmount: number | null | undefined
  billingMode: MedicineBillingMode | null | undefined
  medicineMarkupPercent: number | null | undefined
}) {
  const baseAmount = billableAmount ?? 0
  if (baseAmount <= 0) return 0

  // Treatment.billableAmount stores the historical base for non-fixed billing modes.
  // Apply owner markup once here for pass-through treatments and never double-mark up fixed charges.
  if (billingMode === MedicineBillingMode.FIXED_CHARGE) {
    return roundMoney(baseAmount)
  }

  const markupPercent = Math.max(medicineMarkupPercent ?? 0, 0)
  return roundMoney(baseAmount * (1 + markupPercent / 100))
}

export async function getOwnerFinancialSummary({
  organizationId,
  ownerId,
  monthValue,
}: OwnerFinancialSummaryInput) {
  const { monthStart, monthEnd, monthValue: normalizedMonthValue, label } = getMonthWindow(monthValue)
  const today = new Date()

  const owner = await prisma.owner.findFirst({
    where: {
      id: ownerId,
      organizationId,
    },
    select: {
      id: true,
      name: true,
      yardageRatePerHeadDay: true,
      medicineMarkupPercent: true,
      billingNotes: true,
    },
  })

  if (!owner) return null

  const [openLots, lots, treatments, invoiceSummary] = await Promise.all([
    prisma.lot.findMany({
      where: {
        organizationId,
        ownerId,
        arrivalDate: { lte: today },
        OR: [{ exitDate: null }, { exitDate: { gte: today } }],
      },
      select: {
        headCount: true,
      },
    }),
    prisma.lot.findMany({
      where: {
        organizationId,
        ownerId,
        arrivalDate: { lt: monthEnd },
        OR: [{ exitDate: null }, { exitDate: { gte: monthStart } }],
      },
      select: {
        id: true,
        headCount: true,
        inHeadCount: true,
        inTotalWeight: true,
        outHeadCount: true,
        outTotalWeight: true,
        arrivalDate: true,
        exitDate: true,
        pen: {
          select: {
            name: true,
          },
        },
        ledgerEvents: {
          where: {
            eventDate: { lt: monthEnd },
          },
          orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
          select: {
            eventDate: true,
            headChange: true,
            headAfter: true,
          },
        },
      },
    }),
    prisma.treatment.findMany({
      where: {
        date: { gte: monthStart, lt: monthEnd },
        lot: {
          organizationId,
          ownerId,
        },
      },
      orderBy: [{ medicine: "asc" }, { date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        medicine: true,
        billableAmount: true,
        billingModeSnapshot: true,
      },
    }),
    getInvoiceSummaryForWindow({
      organizationId,
      ownerId,
      monthStart,
      monthEnd,
      monthValue: normalizedMonthValue,
    }),
  ])

  const openInventory = openLots.reduce((sum, lot) => sum + lot.headCount, 0)
  const headDays = lots.reduce(
    (sum, lot) =>
      sum +
      calculateHeadDaysFromLedger({
        arrivalDate: lot.arrivalDate,
        exitDate: lot.exitDate,
        currentHeadCount: lot.headCount,
        monthStart,
        monthEnd,
        ledgerEvents: lot.ledgerEvents,
      }),
    0,
  )
  const yardageRatePerHeadDay = owner.yardageRatePerHeadDay ?? 0
  const yardageAmount = roundMoney(headDays * yardageRatePerHeadDay)
  const feedSummary = await getOwnerFeedSummary({
    organizationId,
    ownerId,
    monthStart,
    monthEnd,
  })

  const groupedTreatmentCharges = new Map<
    string,
    {
      medicine: string
      count: number
      baseAmount: number
      billedAmount: number
    }
  >()

  let treatmentCharges = 0
  let treatmentBaseAmount = 0

  for (const treatment of treatments) {
    const baseAmount = roundMoney(treatment.billableAmount ?? 0)
    const billedAmount = calculateTreatmentChargeWithMarkup({
      billableAmount: baseAmount,
      billingMode: treatment.billingModeSnapshot,
      medicineMarkupPercent: owner.medicineMarkupPercent,
    })
    const medicineName = treatment.medicine.trim() || "Treatment"

    treatmentBaseAmount += baseAmount
    treatmentCharges += billedAmount

    const existing = groupedTreatmentCharges.get(medicineName) ?? {
      medicine: medicineName,
      count: 0,
      baseAmount: 0,
      billedAmount: 0,
    }

    existing.count += 1
    existing.baseAmount = roundMoney(existing.baseAmount + baseAmount)
    existing.billedAmount = roundMoney(existing.billedAmount + billedAmount)

    groupedTreatmentCharges.set(medicineName, existing)
  }

  const estimatedCharges = roundMoney(yardageAmount + treatmentCharges + feedSummary.totalCost)

  return {
    owner,
    monthValue: normalizedMonthValue,
    label,
    openInventory,
    headDays,
    yardageAmount,
    feedLbs: feedSummary.totalLbs,
    feedTons: feedSummary.totalTons,
    feedCost: roundMoney(feedSummary.totalCost),
    feedAverageCostPerTon: feedSummary.averageCostPerTon,
    feedOrganizationEntryCount: feedSummary.organizationEntryCount,
    feedRelevantEntryCount: feedSummary.relevantEntryCount,
    feedAllocatedEntryCount: feedSummary.allocatedEntryCount,
    feedLotSummaries: feedSummary.lotSummaries,
    feedUnallocatedEntries: feedSummary.unallocatedEntries,
    treatmentBaseAmount: roundMoney(treatmentBaseAmount),
    treatmentCharges: roundMoney(treatmentCharges),
    invoiceTotal: invoiceSummary.invoiceTotal,
    estimatedCharges,
    treatmentCount: treatments.length,
    invoiceCount: invoiceSummary.invoiceCount,
    invoiceStatusCounts: invoiceSummary.invoiceStatusCounts,
    invoiceBillingMonthMatchCount: invoiceSummary.invoiceBillingMonthMatchCount,
    invoiceDateFallbackCount: invoiceSummary.invoiceDateFallbackCount,
    monthlyInvoices: invoiceSummary.monthlyInvoices,
    existingInvoice: invoiceSummary.existingInvoice,
    lotsOverlappingMonth: lots.length,
    lotSummaries: lots
      .map((lot) => ({
        id: lot.id,
        headCount: lot.headCount,
        inHeadCount: lot.inHeadCount,
        inTotalWeight: lot.inTotalWeight,
        outHeadCount: lot.outHeadCount,
        outTotalWeight: lot.outTotalWeight,
        arrivalDate: lot.arrivalDate,
        exitDate: lot.exitDate,
        penName: lot.pen.name,
      }))
      .sort((a, b) => a.arrivalDate.getTime() - b.arrivalDate.getTime()),
    hasIncompleteBillingSettings: owner.yardageRatePerHeadDay === null,
    treatmentGroups: Array.from(groupedTreatmentCharges.values()).sort((a, b) => {
      if (b.billedAmount !== a.billedAmount) return b.billedAmount - a.billedAmount
      return a.medicine.localeCompare(b.medicine)
    }),
  }
}

export function buildDraftInvoiceLines(
  summary: NonNullable<Awaited<ReturnType<typeof getOwnerFinancialSummary>>>,
) {
  const lines: DraftInvoiceLine[] = []

  if (summary.headDays > 0 && summary.yardageAmount > 0) {
    lines.push({
      quantity: summary.headDays,
      description: `Yardage - ${summary.label}`,
      weight: null,
      price: summary.owner.yardageRatePerHeadDay ?? 0,
      amount: summary.yardageAmount,
      source: InvoiceLineSource.YARDAGE,
      generated: true,
    })
  }

  if (summary.feedTons > 0 && summary.feedCost > 0) {
    lines.push({
      quantity: roundQuantity(summary.feedTons, 4),
      description: `Feed - ${summary.label}`,
      weight: null,
      price: summary.feedAverageCostPerTon,
      amount: summary.feedCost,
      source: InvoiceLineSource.FEED,
      generated: true,
    })
  }

  for (const group of summary.treatmentGroups) {
    if (group.billedAmount <= 0) continue

    lines.push({
      quantity: 1,
      description: `Treatment - ${group.medicine} (${summary.label})`,
      weight: null,
      price: group.billedAmount,
      amount: group.billedAmount,
      source: InvoiceLineSource.TREATMENT,
      generated: true,
    })
  }

  return lines
}

export function getDraftInvoiceDate(monthValue: string) {
  const { monthEnd } = getMonthWindow(monthValue)
  return new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 0)
}

export function getInvoiceBillingMonth(date: Date) {
  return getBillingMonthValue(date)
}
