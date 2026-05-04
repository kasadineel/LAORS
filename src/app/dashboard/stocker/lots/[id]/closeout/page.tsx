import { notFound, redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { InvoiceStatus, ModuleKey } from "@prisma/client"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { buildDraftInvoiceLines, findExistingNonVoidInvoiceForMonth, getDraftInvoiceDate, getInvoiceBillingMonth, getOwnerFinancialSummary, roundMoney } from "@/lib/stocker-billing"
import { closeStockerLot } from "@/lib/stocker-lot-actions"
import { formatAverageWeightLbs, formatLotLabel, formatTotalWeightLbs } from "@/lib/stocker-labels"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { getMonthWindow, parseDateInput, parseNumberInput, requireStockerAccess, toDateInputValue } from "@/lib/stocker"
import { getEffectiveOutHeadCount } from "@/lib/stocker-weights"
import { cardStyle, inputStyle, metaTextStyle, pageStyle, stackStyle } from "@/lib/stocker-ui"

type LotCloseoutPageProps = {
  params: Promise<{ id: string }> | { id: string }
  searchParams?: Promise<{ month?: string | string[] }> | { month?: string | string[] }
}

export default async function LotCloseoutPage({ params, searchParams }: LotCloseoutPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const monthParam = Array.isArray(resolvedSearchParams.month) ? resolvedSearchParams.month[0] : resolvedSearchParams.month
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId
  const userId = core.user.id

  const lot = await prisma.lot.findFirst({
    where: {
      id: resolvedParams.id,
      organizationId: orgId,
    },
    select: {
      id: true,
      ownerId: true,
      headCount: true,
      inHeadCount: true,
      inTotalWeight: true,
      outHeadCount: true,
      outTotalWeight: true,
      arrivalDate: true,
      exitDate: true,
      notes: true,
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
    },
  })

  if (!lot) notFound()
  const currentLot = lot

  const impliedMonthValue =
    monthParam ??
    `${(currentLot.exitDate ?? new Date()).getFullYear()}-${`${(currentLot.exitDate ?? new Date()).getMonth() + 1}`.padStart(2, "0")}`

  const ownerSummary = await getOwnerFinancialSummary({
    organizationId: orgId,
    ownerId: currentLot.ownerId,
    monthValue: impliedMonthValue,
  })

  if (!ownerSummary) notFound()
  const summary = ownerSummary

  async function finalizeCloseout(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const exitDate = parseDateInput(formData.get("exitDate"), new Date())
    const outHeadCount = parseNumberInput(formData.get("outHeadCount"))
    const outTotalWeight = parseNumberInput(formData.get("outTotalWeight"))
    const monthValue = formData.get("monthValue")?.toString() ?? summary.monthValue

    if (!exitDate) return
    if (outHeadCount !== null && (!Number.isInteger(outHeadCount) || outHeadCount <= 0)) return

    await prisma.$transaction(async (tx) => {
      await closeStockerLot(
        {
          organizationId: orgId,
          lotId: currentLot.id,
          exitDate,
          outHeadCount,
          outTotalWeight,
          createdByUserId: userId,
        },
        tx,
      )
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath(`/dashboard/stocker/lots/${currentLot.id}`)
    revalidatePath(`/dashboard/stocker/lots/${currentLot.id}/closeout`)
    redirect(`/dashboard/stocker/lots/${currentLot.id}/closeout?month=${encodeURIComponent(monthValue)}`)
  }

  async function generateLotOwnerDraftInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const monthValue = formData.get("monthValue")?.toString() ?? summary.monthValue
    const ownerMonthSummary = await getOwnerFinancialSummary({
      organizationId: orgId,
      ownerId: currentLot.ownerId,
      monthValue,
    })

    if (!ownerMonthSummary) return

    if (ownerMonthSummary.existingInvoice) {
      redirect(`/dashboard/stocker/invoices?invoiceId=${encodeURIComponent(ownerMonthSummary.existingInvoice.id)}`)
    }

    const lines = buildDraftInvoiceLines(ownerMonthSummary)
    if (lines.length === 0) {
      redirect(`/dashboard/stocker/reports?ownerId=${encodeURIComponent(ownerMonthSummary.owner.id)}&month=${encodeURIComponent(ownerMonthSummary.monthValue)}`)
    }

    const invoiceDate = getDraftInvoiceDate(ownerMonthSummary.monthValue)
    const { monthStart, monthEnd } = getMonthWindow(ownerMonthSummary.monthValue)
    const total = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0))

    const invoiceResult = await prisma.$transaction(async (tx) => {
      const existingInvoice = await findExistingNonVoidInvoiceForMonth(
        {
          organizationId: orgId,
          ownerId: ownerMonthSummary.owner.id,
          monthStart,
          monthEnd,
          monthValue: ownerMonthSummary.monthValue,
        },
        tx,
      )

      if (existingInvoice) {
        return { id: existingInvoice.id, reused: true as const }
      }

      const invoice = await tx.invoice.create({
        data: {
          ownerId: ownerMonthSummary.owner.id,
          organizationId: orgId,
          date: invoiceDate,
          billingMonth: getInvoiceBillingMonth(invoiceDate),
          status: InvoiceStatus.DRAFT,
          total,
          lines: {
            create: lines,
          },
        },
        select: { id: true },
      })

      return { id: invoice.id, reused: false as const }
    })

    revalidatePath("/dashboard/stocker/reports")
    revalidatePath("/dashboard/stocker/invoices")
    revalidatePath(`/dashboard/stocker/lots/${currentLot.id}/closeout`)
    redirect(`/dashboard/stocker/invoices?invoiceId=${encodeURIComponent(invoiceResult.id)}`)
  }

  const effectiveOutHeadCount = getEffectiveOutHeadCount(currentLot.outHeadCount, currentLot.headCount)
  const lotLabel = formatLotLabel({
    ownerName: currentLot.owner.name,
    penName: currentLot.pen.name,
    arrivalDate: currentLot.arrivalDate,
  })

  return (
    <main style={pageStyle}>
      <PageHeader
        title={`${lotLabel} Closeout`}
        subtitle="Review the lot’s final head count, weight snapshot, month billing context, and invoice handoff before closing the lot out."
        badge={currentLot.exitDate ? "Closeout Recorded" : "Closeout Review"}
        rightSlot={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button href={`/dashboard/stocker/lots/${currentLot.id}`} variant="secondary" size="sm">
              View Lot Detail
            </Button>
            <Button href={`/dashboard/stocker/reports?ownerId=${currentLot.ownerId}&month=${summary.monthValue}`} variant="secondary" size="sm">
              Owner Billing Review
            </Button>
          </div>
        }
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
        monthLabel={summary.label}
      />

      <CardSection title="Closeout Snapshot">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {[
            { label: "Owner", value: currentLot.owner.name },
            { label: "Pen", value: currentLot.pen.name },
            { label: "Current Head", value: `${currentLot.headCount}` },
            { label: "Status", value: currentLot.exitDate ? "Closed" : "Open" },
            { label: "In Total Weight", value: formatTotalWeightLbs(currentLot.inTotalWeight) },
            { label: "Avg In Weight", value: formatAverageWeightLbs(currentLot.inTotalWeight, currentLot.inHeadCount ?? currentLot.headCount) },
            { label: "Out Head Count", value: effectiveOutHeadCount?.toString() ?? "Not recorded" },
            { label: "Out Total Weight", value: formatTotalWeightLbs(currentLot.outTotalWeight) },
          ].map((item) => (
            <div key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, color: "var(--ink)", fontWeight: 700, fontSize: 20 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </CardSection>

      {!currentLot.exitDate ? (
        <CardSection title="Finalize Lot Closeout">
          <form action={finalizeCloseout} style={stackStyle}>
            <input type="hidden" name="monthValue" value={summary.monthValue} />
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <Input label="Exit Date" name="exitDate" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
              <Input label="Out Head Count" name="outHeadCount" inputMode="numeric" defaultValue={currentLot.headCount} style={inputStyle} />
              <Input label="Total Out Weight (lbs)" name="outTotalWeight" type="number" min="0" step="0.1" inputMode="decimal" defaultValue={currentLot.outTotalWeight ?? ""} style={inputStyle} />
            </div>
            <div style={metaTextStyle}>
              Closing the lot preserves the final shipped group snapshot and keeps future billing tied to the recorded month context.
            </div>
            <div>
              <Button type="submit" variant="primary">
                Record Closeout
              </Button>
            </div>
          </form>
        </CardSection>
      ) : null}

      <CardSection title="Owner Settlement Context">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {[
            { label: "Head-Days", value: summary.headDays.toLocaleString(), note: `Ledger-based for ${summary.label}` },
            { label: "Yardage", value: `$${summary.yardageAmount.toFixed(2)}`, note: "Owner month subtotal" },
            { label: "Feed", value: `$${summary.feedCost.toFixed(2)}`, note: `${summary.feedTons.toFixed(2)} tons allocated` },
            { label: "Treatments", value: `$${summary.treatmentCharges.toFixed(2)}`, note: `${summary.treatmentCount} treatment records` },
            { label: "Estimated Charges", value: `$${summary.estimatedCharges.toFixed(2)}`, note: "Yardage + feed + treatments" },
            {
              label: "Existing Invoice",
              value: summary.existingInvoice ? `${summary.existingInvoice.status}` : "None",
              note: summary.existingInvoice ? "A billing document already exists for this owner/month." : "No non-void invoice exists yet.",
            },
          ].map((item) => (
            <div key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, color: "var(--ink)", fontWeight: 700, fontSize: 22 }}>{item.value}</div>
              <div style={{ ...metaTextStyle, marginTop: 8 }}>{item.note}</div>
            </div>
          ))}
        </div>
      </CardSection>

      <CardSection title="Next Billing Action">
        <div style={stackStyle}>
          <div style={metaTextStyle}>
            Use the owner billing review if you need detail. Use invoice generation here if you are ready to turn this month’s owner summary into a billing document.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {summary.existingInvoice ? (
              <Button href={`/dashboard/stocker/invoices?invoiceId=${encodeURIComponent(summary.existingInvoice.id)}`} variant="primary">
                Open Existing Invoice
              </Button>
            ) : (
              <form action={generateLotOwnerDraftInvoice}>
                <input type="hidden" name="monthValue" value={summary.monthValue} />
                <Button type="submit" variant="primary">
                  Generate Draft Invoice
                </Button>
              </form>
            )}
            <Button href={`/dashboard/stocker/reports?ownerId=${currentLot.ownerId}&month=${summary.monthValue}`} variant="secondary">
              Review Full Owner Summary
            </Button>
          </div>
          {currentLot.notes ? (
            <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>Lot Notes</div>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>{currentLot.notes}</p>
            </div>
          ) : null}
        </div>
      </CardSection>
    </main>
  )
}
