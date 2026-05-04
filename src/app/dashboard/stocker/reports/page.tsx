import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { InvoiceStatus, ModuleKey, StockerActivityType } from "@prisma/client"
import { getInvoiceStatusLabel, formatAverageWeightLbs, formatLotLabel, formatTotalWeightLbs } from "@/lib/stocker-labels"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { buildDraftInvoiceLines, findExistingNonVoidInvoiceForMonth, getDraftInvoiceDate, getInvoiceBillingMonth, getOwnerFinancialSummary, roundMoney } from "@/lib/stocker-billing"
import { logStockerActivity } from "@/lib/stocker-activity"
import { getEffectiveOutHeadCount } from "@/lib/stocker-weights"
import { getMonthWindow, requireStockerAccess } from "@/lib/stocker"
import {
  cardStyle,
  emptyStateStyle,
  inputStyle,
  metaTextStyle,
  metricCardStyle,
  metricLabelStyle,
  metricValueStyle,
  pageStyle,
  stackStyle,
} from "@/lib/stocker-ui"

type ReportsPageProps = {
  searchParams?: Promise<{ month?: string | string[]; ownerId?: string | string[] }> | { month?: string | string[]; ownerId?: string | string[] }
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId
  const userId = core.user.id
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const monthParam = Array.isArray(resolvedSearchParams.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams.month
  const ownerIdParam = Array.isArray(resolvedSearchParams.ownerId)
    ? resolvedSearchParams.ownerId[0]
    : resolvedSearchParams.ownerId
  const { monthValue, label } = getMonthWindow(monthParam)

  const owners = await prisma.owner.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      yardageRatePerHeadDay: true,
      medicineMarkupPercent: true,
    },
  })

  const summary = ownerIdParam
    ? await getOwnerFinancialSummary({
        organizationId: orgId,
        ownerId: ownerIdParam,
        monthValue,
      })
    : null

  const feedSummaryDescription = summary
    ? summary.feedAllocatedEntryCount > 0
      ? `${summary.feedAllocatedEntryCount} feed entr${summary.feedAllocatedEntryCount === 1 ? "y" : "ies"}, ${summary.feedTons.toFixed(2)} tons allocated this month.`
      : summary.feedRelevantEntryCount > 0
        ? `${summary.feedRelevantEntryCount} feed entr${summary.feedRelevantEntryCount === 1 ? "y was" : "ies were"} recorded against this owner's active lots, but none allocated cleanly. Review shared-pen allocation rules.`
        : summary.feedOrganizationEntryCount > 0
          ? `${summary.feedOrganizationEntryCount} yard feed entr${summary.feedOrganizationEntryCount === 1 ? "y exists" : "ies exist"} this month, but none were recorded against this owner's active lots or pens.`
          : `No feed entries were recorded for the organization in ${summary.label}.`
    : null

  const invoiceSummaryDescription = summary
    ? summary.invoiceCount > 0
      ? `${summary.invoiceCount} non-void invoice${summary.invoiceCount === 1 ? "" : "s"} counted: ${summary.invoiceStatusCounts.draft} draft, ${summary.invoiceStatusCounts.finalized} finalized.`
      : `No non-void invoices exist for this owner in ${summary.monthValue}. Matching uses billingMonth first, then invoice date for older rows.`
    : null

  async function generateDraftInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const ownerId = formData.get("ownerId")?.toString()
    const selectedMonth = formData.get("month")?.toString()
    if (!ownerId) return

    const draftSummary = await getOwnerFinancialSummary({
      organizationId: orgId,
      ownerId,
      monthValue: selectedMonth,
    })

    if (!draftSummary) return

    if (draftSummary.existingInvoice) {
      redirect(`/dashboard/stocker/invoices?invoiceId=${encodeURIComponent(draftSummary.existingInvoice.id)}`)
    }

    const lines = buildDraftInvoiceLines(draftSummary)
    if (lines.length === 0) {
      redirect(`/dashboard/stocker/reports?ownerId=${encodeURIComponent(ownerId)}&month=${encodeURIComponent(draftSummary.monthValue)}`)
    }

    const invoiceDate = getDraftInvoiceDate(draftSummary.monthValue)
    const { monthStart, monthEnd } = getMonthWindow(draftSummary.monthValue)
    const total = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0))

    const invoiceResult = await prisma.$transaction(async (tx) => {
      const existingInvoice = await findExistingNonVoidInvoiceForMonth(
        {
          organizationId: orgId,
          ownerId: draftSummary.owner.id,
          monthStart,
          monthEnd,
          monthValue: draftSummary.monthValue,
        },
        tx,
      )

      if (existingInvoice) {
        return { id: existingInvoice.id, reused: true as const }
      }

      const createdInvoice = await tx.invoice.create({
        data: {
          ownerId: draftSummary.owner.id,
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

      return { id: createdInvoice.id, reused: false as const }
    })

    if (!invoiceResult.reused) {
      await logStockerActivity({
        organizationId: orgId,
        type: StockerActivityType.INVOICE_CREATED,
        message: `Generated draft invoice for ${draftSummary.owner.name} totaling $${total.toFixed(2)}.`,
        metadata: {
          ownerId: draftSummary.owner.id,
          ownerName: draftSummary.owner.name,
          month: draftSummary.monthValue,
          lineCount: lines.length,
          total,
          source: "owner-financial-summary",
        },
        createdByUserId: userId,
      })
    }

    revalidatePath("/dashboard/stocker")
    revalidatePath("/dashboard/stocker/reports")
    revalidatePath("/dashboard/stocker/invoices")
    redirect(`/dashboard/stocker/invoices?invoiceId=${encodeURIComponent(invoiceResult.id)}`)
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Review Billing"
        subtitle="Use this page to explain the monthly number first. Once the charges look right, move forward into the invoice document."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
        monthLabel={label}
      />
      <ActionBar
        primaryAction={{ href: "/dashboard/stocker/invoices", label: "Issue Invoices" }}
        secondaryActions={[
          { href: "/dashboard/stocker/feed/monthly", label: "Feed Summary" },
          { href: "/dashboard/stocker/reports/owner-statement", label: "Owner Statement CSV" },
        ]}
      />

      <CardSection title="Start Billing Review">
        {owners.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No owners yet.</strong>
            Create an owner before building a monthly billing summary.
          </div>
        ) : (
          <form action="/dashboard/stocker/reports" method="get" style={{ ...stackStyle, maxWidth: 720 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <Input label="Month" className="stocker-input" type="month" name="month" defaultValue={monthValue} style={inputStyle} />
              <Select label="Owner" name="ownerId" defaultValue={summary?.owner.id ?? ownerIdParam ?? ""} required style={inputStyle}>
                  <option value="" disabled>
                    Select owner
                  </option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </Select>
            </div>
            <div>
              <Button type="submit" variant="primary">
                Review Billing
              </Button>
            </div>
          </form>
        )}
      </CardSection>

      {summary ? (
        <>
          <CardSection title="Billing Path">
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>1. Review Month Context</div>
                <p style={{ marginTop: 10, marginBottom: 0, color: "var(--muted)", lineHeight: 1.7 }}>
                  {summary.owner.name} · {summary.label} · {summary.lotSummaries.length} lot{summary.lotSummaries.length === 1 ? "" : "s"} contributing to this owner view.
                </p>
              </div>
              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>2. Confirm Charges</div>
                <p style={{ marginTop: 10, marginBottom: 0, color: "var(--muted)", lineHeight: 1.7 }}>
                  Yardage, feed, and treatments below are calculated from the current trust layer. Existing invoices are shown separately so you can avoid double billing.
                </p>
              </div>
              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>3. Open Billing Document</div>
                <p style={{ marginTop: 10, marginBottom: 0, color: "var(--muted)", lineHeight: 1.7 }}>
                  {summary.existingInvoice
                    ? "An invoice already exists for this owner/month. Review that document instead of generating a duplicate."
                    : "No invoice exists yet for this owner/month. Generate a draft after reviewing the charge breakdown."}
                </p>
              </div>
            </div>
          </CardSection>

          <CardSection title={`Owner Month Review: ${summary.owner.name}`}>
            <p style={{ ...metaTextStyle, marginTop: 0, marginBottom: 16, lineHeight: 1.7 }}>
              Estimated charges come from ledger-based head-days, allocated feed, and stored treatment snapshots. Invoice totals on this screen include draft and finalized invoices only. Voided invoices are excluded.
            </p>
            <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              {[
                {
                  label: "Open Inventory",
                  value: summary.openInventory.toLocaleString(),
                  description: "Head currently open for this owner.",
                },
                {
                  label: "Head-Days",
                  value: summary.headDays.toLocaleString(),
                  description: `Accumulated across lots overlapping ${summary.label}.`,
                },
                {
                  label: "Treatment Charges",
                  value: `$${summary.treatmentCharges.toFixed(2)}`,
                  description:
                    summary.owner.medicineMarkupPercent > 0
                      ? `Includes ${summary.owner.medicineMarkupPercent.toFixed(2)}% owner markup where allowed.`
                      : "Uses stored treatment billing snapshots with no owner markup.",
                },
                {
                  label: "Feed Charges",
                  value: `$${summary.feedCost.toFixed(2)}`,
                  description: feedSummaryDescription ?? "No feed cost allocated for this month.",
                },
                {
                  label: "Yardage Amount",
                  value: `$${summary.yardageAmount.toFixed(2)}`,
                  description:
                    summary.owner.yardageRatePerHeadDay === null
                      ? "Billing settings incomplete. Yardage rate is not set."
                      : `Calculated at $${summary.owner.yardageRatePerHeadDay.toFixed(2)} per head-day.`,
                },
                {
                  label: "Invoice Total",
                  value: `$${summary.invoiceTotal.toFixed(2)}`,
                  description: invoiceSummaryDescription ?? "No non-void invoices matched this billing month.",
                },
                {
                  label: "Estimated Charges",
                  value: `$${summary.estimatedCharges.toFixed(2)}`,
                  description: "Current month estimate from yardage, feed, and treatment activity.",
                },
              ].map((item) => (
                <article key={item.label} className="stocker-card" style={metricCardStyle}>
                  <div style={metricLabelStyle}>{item.label}</div>
                  <div style={metricValueStyle}>{item.value}</div>
                  <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>{item.description}</p>
                </article>
              ))}
            </div>
          </CardSection>

          <CardSection title="Charge Breakdown">
            <details
              style={{
                border: "1px solid rgba(16, 42, 67, 0.08)",
                borderRadius: 16,
                padding: 14,
                background: "rgba(255, 255, 255, 0.7)",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--ink)" }}>
                View yardage, feed, treatment, and invoice match logic
              </summary>
              <p style={{ ...metaTextStyle, marginTop: 12, marginBottom: 16, lineHeight: 1.7 }}>
                Open this when you need to explain exactly why the owner total is what it is.
              </p>
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>Yardage Logic</div>
                <div style={{ ...metaTextStyle, marginTop: 8, lineHeight: 1.7 }}>
                  {summary.headDays.toLocaleString()} head-days × $
                  {(summary.owner.yardageRatePerHeadDay ?? 0).toFixed(2)} per head-day
                </div>
                <div style={{ marginTop: 12, fontWeight: 700, color: "var(--ink)" }}>
                  Yardage subtotal: ${summary.yardageAmount.toFixed(2)}
                </div>
                {summary.owner.yardageRatePerHeadDay === null ? (
                  <p style={{ marginBottom: 0, marginTop: 10, color: "var(--muted)", lineHeight: 1.6 }}>
                    Owner billing settings are incomplete. Yardage is currently treated as $0.00.
                  </p>
                ) : null}
              </div>

              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>Treatment Charge Logic</div>
                <div style={{ ...metaTextStyle, marginTop: 8, lineHeight: 1.7 }}>
                  Base treatment total: ${summary.treatmentBaseAmount.toFixed(2)}
                </div>
                <div style={{ ...metaTextStyle, marginTop: 6, lineHeight: 1.7 }}>
                  Owner markup: {summary.owner.medicineMarkupPercent.toFixed(2)}% where treatment billing mode allows markup
                </div>
                {summary.treatmentGroups.length === 0 ? (
                  <div style={{ ...metaTextStyle, marginTop: 12 }}>No treatments billed for {summary.label}.</div>
                ) : (
                  <div style={{ ...stackStyle, marginTop: 14 }}>
                    {summary.treatmentGroups.map((group) => (
                      <div
                        key={group.medicine}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          paddingBottom: 8,
                          borderBottom: "1px solid rgba(16, 42, 67, 0.08)",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{group.medicine}</div>
                          <div style={metaTextStyle}>
                            {group.count} treatment record{group.count === 1 ? "" : "s"} · Base ${group.baseAmount.toFixed(2)}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: "var(--ink)" }}>${group.billedAmount.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>Feed Charge Logic</div>
                <div style={{ ...metaTextStyle, marginTop: 8, lineHeight: 1.7 }}>
                  {summary.feedAllocatedEntryCount} included feed entr{summary.feedAllocatedEntryCount === 1 ? "y" : "ies"} · {summary.feedLbs.toLocaleString()} lbs fed · {summary.feedTons.toFixed(2)} tons allocated
                </div>
                <div style={{ ...metaTextStyle, marginTop: 6, lineHeight: 1.7 }}>
                  Weighted feed cost: ${summary.feedAverageCostPerTon.toFixed(2)} per ton
                </div>
                <div style={{ marginTop: 12, fontWeight: 700, color: "var(--ink)" }}>
                  Feed subtotal: ${summary.feedCost.toFixed(2)}
                </div>
                {summary.feedAllocatedEntryCount === 0 ? (
                  <p style={{ marginBottom: 0, marginTop: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                    {feedSummaryDescription}
                  </p>
                ) : null}
                {summary.feedLotSummaries.length > 0 ? (
                  <div style={{ ...stackStyle, marginTop: 14 }}>
                    {summary.feedLotSummaries.slice(0, 4).map((lot) => (
                      <div
                        key={lot.lotId}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          paddingBottom: 8,
                          borderBottom: "1px solid rgba(16, 42, 67, 0.08)",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{lot.lotLabel}</div>
                          <div style={metaTextStyle}>
                            {lot.totalTons.toFixed(2)} tons · {lot.totalLbs.toLocaleString()} lbs
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: "var(--ink)" }}>${lot.totalCost.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {summary.feedUnallocatedEntries.length > 0 ? (
                  <p style={{ marginBottom: 0, marginTop: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                    {summary.feedUnallocatedEntries.length} feed entr{summary.feedUnallocatedEntries.length === 1 ? "y was" : "ies were"} tied to this owner's active lots but could not be allocated from the current rule history.
                  </p>
                ) : null}
              </div>

              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>Invoice Match Logic</div>
                <div style={{ ...metaTextStyle, marginTop: 8, lineHeight: 1.7 }}>
                  Billing month match: {summary.invoiceBillingMonthMatchCount} invoice{summary.invoiceBillingMonthMatchCount === 1 ? "" : "s"}
                  {summary.invoiceDateFallbackCount > 0
                    ? ` · ${summary.invoiceDateFallbackCount} legacy invoice${summary.invoiceDateFallbackCount === 1 ? "" : "s"} matched by invoice date`
                    : ""}
                </div>
                <div style={{ ...metaTextStyle, marginTop: 6, lineHeight: 1.7 }}>
                  Statuses counted: {summary.invoiceStatusCounts.draft} draft · {summary.invoiceStatusCounts.finalized} finalized · void invoices excluded
                </div>
                <div style={{ marginTop: 12, fontWeight: 700, color: "var(--ink)" }}>
                  Invoice total counted: ${summary.invoiceTotal.toFixed(2)}
                </div>
                <p style={{ marginBottom: 0, marginTop: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                  {invoiceSummaryDescription}
                </p>
              </div>

              <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>Total Logic</div>
                <div style={{ ...metaTextStyle, marginTop: 8, lineHeight: 1.7 }}>
                  Estimated charges = yardage + feed + treatments
                </div>
                <div style={{ marginTop: 12, fontWeight: 700, color: "var(--ink)" }}>
                  ${summary.yardageAmount.toFixed(2)} + ${summary.feedCost.toFixed(2)} + ${summary.treatmentCharges.toFixed(2)} = ${summary.estimatedCharges.toFixed(2)}
                </div>
                <div style={{ ...metaTextStyle, marginTop: 8 }}>
                  Existing invoices already posted this month: ${summary.invoiceTotal.toFixed(2)}
                </div>
                <p style={{ marginBottom: 0, marginTop: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                  {summary.owner.billingNotes?.trim() || "No billing notes saved for this owner."}
                </p>
              </div>
              </div>
            </details>
          </CardSection>

          <CardSection title="Move Into Invoice Document">
            <div className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>Ready to Bill</div>
              <p style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7 }}>
                Review the estimated charges and charge breakdown above, then export the statement or generate a draft invoice for manager review.
              </p>
              <div style={{ ...metaTextStyle, marginTop: 8 }}>
                Owner: {summary.owner.name} · Estimated charges: ${summary.estimatedCharges.toFixed(2)} · Lots in review: {summary.lotSummaries.length}
              </div>
              {summary.monthlyInvoices.length > 0 ? (
                <div className="stocker-card" style={{ ...cardStyle, padding: 14, marginTop: 16 }}>
                  <div style={{ fontWeight: 700, color: "var(--ink)" }}>Existing invoice already found for {summary.label}</div>
                  <div style={{ ...stackStyle, marginTop: 10 }}>
                    {summary.monthlyInvoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          paddingBottom: 8,
                          borderBottom: "1px solid rgba(16, 42, 67, 0.08)",
                        }}
                      >
                        <div style={{ color: "var(--ink)", fontWeight: 600 }}>
                          {getInvoiceStatusLabel(invoice.status)} · {invoice.date.toLocaleDateString()}
                        </div>
                        <div style={metaTextStyle}>${invoice.total.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                  <p style={{ marginBottom: 0, marginTop: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                    Duplicate draft generation is blocked for the same owner and billing month. Review the existing invoice instead.
                  </p>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <Button
                  href={`/dashboard/stocker/reports/owner-statement?ownerId=${encodeURIComponent(summary.owner.id)}&month=${encodeURIComponent(summary.monthValue)}`}
                  variant="secondary"
                >
                  Export Statement
                </Button>
                {summary.existingInvoice ? (
                  <Button href={`/dashboard/stocker/invoices?invoiceId=${encodeURIComponent(summary.existingInvoice.id)}`}>
                    Review Existing Invoice
                  </Button>
                ) : (
                  <form action={generateDraftInvoice}>
                    <input type="hidden" name="ownerId" value={summary.owner.id} />
                    <input type="hidden" name="month" value={summary.monthValue} />
                    <Button
                      type="submit"
                      disabled={summary.estimatedCharges <= 0}
                    >
                      Generate Draft Invoice
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </CardSection>

          <CardSection title="Supporting Lot Detail">
            {summary.lotSummaries.length === 0 ? (
              <div className="stocker-empty-state" style={emptyStateStyle}>
                No lots overlap {summary.label} for this owner.
              </div>
            ) : (
              <details
                style={{
                  border: "1px solid rgba(16, 42, 67, 0.08)",
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(255, 255, 255, 0.7)",
                }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--ink)" }}>
                  View {summary.lotSummaries.length} lot{summary.lotSummaries.length === 1 ? "" : "s"} included in this review
                </summary>
                <p style={{ ...metaTextStyle, marginTop: 12, marginBottom: 0, lineHeight: 1.7 }}>
                  Use this only when you need to explain which lots contributed to the current month estimate.
                </p>
                <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                  {summary.lotSummaries.map((lot) => (
                    <div
                      key={lot.id}
                      className="stocker-card"
                      style={{
                        ...cardStyle,
                        padding: 16,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 16,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                          {formatLotLabel({
                            ownerName: summary.owner.name,
                            penName: lot.penName,
                            arrivalDate: lot.arrivalDate,
                          })}
                        </div>
                        <div style={metaTextStyle}>
                          Head count: {lot.headCount} · In total: {formatTotalWeightLbs(lot.inTotalWeight)} · Avg in:{" "}
                          {formatAverageWeightLbs(lot.inTotalWeight, lot.inHeadCount ?? lot.headCount)}
                        </div>
                        <div style={metaTextStyle}>
                          Out head count: {getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount) ?? "Not recorded"} · Out total:{" "}
                          {formatTotalWeightLbs(lot.outTotalWeight)} · Avg out:{" "}
                          {formatAverageWeightLbs(
                            lot.outTotalWeight,
                            getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount),
                          )}
                        </div>
                        <div style={metaTextStyle}>
                          Arrival: {lot.arrivalDate.toLocaleDateString()} · Exit: {lot.exitDate ? lot.exitDate.toLocaleDateString() : "Open"}
                        </div>
                      </div>
                      <Button href={`/dashboard/stocker/lots/${lot.id}`} variant="secondary" size="sm">
                        View Lot Detail
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardSection>
        </>
      ) : owners.length > 0 ? (
        <CardSection title="Monthly Owner Financial Summary">
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Select an owner and month to review estimated charges and generate a draft invoice.
          </div>
        </CardSection>
      ) : null}
    </main>
  )
}
