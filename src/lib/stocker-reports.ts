import { InvoiceStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { formatAverageWeightLbs, formatLotLabel, formatTotalWeightLbs } from "@/lib/stocker-labels"
import { calculateHeadDaysFromLedger } from "@/lib/stocker-ledger"
import { getEffectiveOutHeadCount } from "@/lib/stocker-weights"
import { getMonthWindow } from "@/lib/stocker"

type OwnerStatementInput = {
  organizationId: string
  ownerId: string
  monthValue?: string
}

function formatDate(value: Date | null) {
  if (!value) return ""
  return value.toISOString().slice(0, 10)
}

function csvCell(value: string | number | null | undefined) {
  const normalized = value === null || value === undefined ? "" : String(value)
  return `"${normalized.replaceAll(`"`, `""`)}"`
}

function csvRow(values: Array<string | number | null | undefined>) {
  return values.map(csvCell).join(",")
}

function sanitizeFilenamePart(value: string) {
  return value.trim().replaceAll(/[^a-zA-Z0-9_-]+/g, "-").replaceAll(/-+/g, "-").replaceAll(/^-|-$/g, "") || "owner"
}

export async function getOwnerStatementData({
  organizationId,
  ownerId,
  monthValue,
}: OwnerStatementInput) {
  const { monthStart, monthEnd, monthValue: normalizedMonthValue } = getMonthWindow(monthValue)
  const today = new Date()

  const owner = await prisma.owner.findFirst({
    where: {
      id: ownerId,
      organizationId,
    },
    select: {
      id: true,
      name: true,
    },
  })

  if (!owner) return null

  const [openLots, lots, treatments, invoices] = await Promise.all([
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
      orderBy: [{ arrivalDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        headCount: true,
        inHeadCount: true,
        inTotalWeight: true,
        outHeadCount: true,
        outTotalWeight: true,
        arrivalDate: true,
        exitDate: true,
        owner: {
          select: {
            name: true,
          },
        },
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
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        date: true,
        medicine: true,
        dosePerHead: true,
        notes: true,
        lot: {
          select: {
            arrivalDate: true,
            owner: { select: { name: true } },
            pen: { select: { name: true } },
          },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId,
        ownerId,
        status: { not: InvoiceStatus.VOID },
        OR: [
          { billingMonth: normalizedMonthValue },
          {
            billingMonth: null,
            date: { gte: monthStart, lt: monthEnd },
          },
        ],
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        date: true,
        total: true,
        lines: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            invoiceId: true,
            quantity: true,
            description: true,
            weight: true,
            price: true,
            amount: true,
          },
        },
      },
    }),
  ])

  const openHeadCount = openLots.reduce((sum, lot) => sum + lot.headCount, 0)
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
  const invoiceTotal = invoices.reduce((sum, invoice) => sum + invoice.total, 0)
  const invoiceLines = invoices.flatMap((invoice) => invoice.lines)

  return {
    owner,
    monthValue: normalizedMonthValue,
    generatedAt: new Date(),
    summary: {
      openHeadCount,
      headDays,
      lotCount: lots.length,
      invoiceTotal,
    },
    lots,
    treatments,
    invoices,
    invoiceLines,
  }
}

export function buildOwnerStatementCsv(
  statement: NonNullable<Awaited<ReturnType<typeof getOwnerStatementData>>>,
) {
  const sections = [
    [
      csvRow(["Owner Name", statement.owner.name]),
      csvRow(["Month", statement.monthValue]),
      csvRow(["Generated Timestamp", statement.generatedAt.toISOString()]),
    ].join("\n"),
    [
      "Summary",
      csvRow(["Open head count (as of today)", statement.summary.openHeadCount]),
      csvRow(["Head-days for month", statement.summary.headDays]),
      csvRow(["Lots overlapping month", statement.summary.lotCount]),
      csvRow(["Invoice total for month", statement.summary.invoiceTotal.toFixed(2)]),
    ].join("\n"),
    [
      "Lots",
      csvRow([
        "lot",
        "headCount",
        "inTotalWeight",
        "avgInWeight",
        "outHeadCount",
        "outTotalWeight",
        "avgOutWeight",
        "arrivalDate",
        "exitDate",
      ]),
      ...statement.lots.map((lot) =>
        csvRow([
          formatLotLabel({
            ownerName: lot.owner.name,
            penName: lot.pen.name,
            arrivalDate: lot.arrivalDate,
          }),
          lot.headCount,
          formatTotalWeightLbs(lot.inTotalWeight),
          formatAverageWeightLbs(lot.inTotalWeight, lot.inHeadCount ?? lot.headCount),
          getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount),
          formatTotalWeightLbs(lot.outTotalWeight),
          formatAverageWeightLbs(lot.outTotalWeight, getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount)),
          formatDate(lot.arrivalDate),
          formatDate(lot.exitDate),
        ]),
      ),
    ].join("\n"),
    [
      "Treatments",
      csvRow(["date", "medicine", "dosePerHead", "lot", "notes"]),
      ...statement.treatments.map((treatment) =>
        csvRow([
          formatDate(treatment.date),
          treatment.medicine,
          treatment.dosePerHead,
          formatLotLabel({
            ownerName: treatment.lot.owner.name,
            penName: treatment.lot.pen.name,
            arrivalDate: treatment.lot.arrivalDate,
          }),
          treatment.notes,
        ]),
      ),
    ].join("\n"),
    [
      "Invoices",
      csvRow(["invoice", "date", "total"]),
      ...statement.invoices.map((invoice) =>
        csvRow([`Invoice ${formatDate(invoice.date)}`, formatDate(invoice.date), invoice.total.toFixed(2)]),
      ),
    ].join("\n"),
    [
      "Invoice Lines",
      csvRow(["invoice", "quantity", "description", "weight", "price", "amount"]),
      ...statement.invoiceLines.map((line) =>
        csvRow([
          `Invoice ${statement.invoices.find((invoice) => invoice.id === line.invoiceId)?.date.toISOString().slice(0, 10) ?? ""}`,
          line.quantity,
          line.description,
          line.weight,
          line.price.toFixed(2),
          line.amount.toFixed(2),
        ]),
      ),
    ].join("\n"),
  ]

  return `\uFEFF${sections.join("\n\n")}\n`
}

export function getOwnerStatementFilename(ownerName: string, monthValue: string) {
  return `laors-owner-statement_${sanitizeFilenamePart(ownerName)}_${monthValue}.csv`
}
