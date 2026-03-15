import { notFound } from "next/navigation"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { calculateTreatmentChargeWithMarkup } from "@/lib/stocker-billing"
import { calculateHeadDaysFromLedger } from "@/lib/stocker-ledger"
import {
  formatAverageWeightLbs,
  formatLotLedgerEventMessage,
  formatLotLabel,
  formatTotalWeightLbs,
  getLotAdjustmentTypeLabel,
} from "@/lib/stocker-labels"
import { prisma } from "@/lib/prisma"
import { getRoleDisplayName, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { getMonthWindow, requireStockerAccess } from "@/lib/stocker"
import { getEffectiveOutHeadCount } from "@/lib/stocker-weights"
import { cardStyle, emptyStateStyle, metaTextStyle, pageStyle, stackStyle } from "@/lib/stocker-ui"

type LotDetailPageProps = {
  params: Promise<{ id: string }> | { id: string }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export default async function LotDetailPage({ params }: LotDetailPageProps) {
  const resolvedParams = await params
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId
  const { monthStart, monthEnd, monthValue, label } = getMonthWindow()

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
          yardageRatePerHeadDay: true,
          medicineMarkupPercent: true,
          billingNotes: true,
        },
      },
      pen: {
        select: {
          name: true,
        },
      },
      adjustments: {
        orderBy: [{ adjustmentDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          type: true,
          direction: true,
          quantity: true,
          adjustmentDate: true,
          notes: true,
          createdBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      treatments: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          medicine: true,
          headTreated: true,
          dosePerHead: true,
          totalUnitsUsed: true,
          billableAmount: true,
          billingModeSnapshot: true,
          costPerUnitSnapshot: true,
          date: true,
          createdAt: true,
          notes: true,
          medicineRecord: {
            select: {
              unitLabel: true,
            },
          },
        },
      },
      ledgerEvents: {
        orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          eventType: true,
          eventDate: true,
          headChange: true,
          headAfter: true,
          notes: true,
          metadata: true,
          createdAt: true,
          createdBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      _count: {
        select: {
          adjustments: true,
          treatments: true,
          moves: true,
        },
      },
    },
  })

  if (!lot) notFound()
  const lotLabel = formatLotLabel({
    ownerName: lot.owner.name,
    penName: lot.pen.name,
    arrivalDate: lot.arrivalDate,
  })
  const effectiveOutHeadCount = getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount)
  const headDaysThisMonth = calculateHeadDaysFromLedger({
    arrivalDate: lot.arrivalDate,
    exitDate: lot.exitDate,
    currentHeadCount: lot.headCount,
    monthStart,
    monthEnd,
    ledgerEvents: lot.ledgerEvents,
  })
  const monthTreatments = lot.treatments.filter((treatment) => treatment.date >= monthStart && treatment.date < monthEnd)
  const treatmentChargesThisMonth = roundMoney(
    monthTreatments.reduce(
      (sum, treatment) =>
        sum +
        calculateTreatmentChargeWithMarkup({
          billableAmount: treatment.billableAmount,
          billingMode: treatment.billingModeSnapshot,
          medicineMarkupPercent: lot.owner.medicineMarkupPercent,
        }),
      0,
    ),
  )
  const yardageEstimate = roundMoney(headDaysThisMonth * (lot.owner.yardageRatePerHeadDay ?? 0))
  const lastAdjustment = lot.adjustments[0] ?? null
  const lastTreatment = lot.treatments[0] ?? null
  const timelineEntries = [
    ...lot.ledgerEvents.map((event) => ({
      id: `ledger-${event.id}`,
      occurredAt: event.eventDate,
      createdAt: event.createdAt,
      title: formatLotLedgerEventMessage({
        eventType: event.eventType,
        headChange: event.headChange,
        metadata: event.metadata,
      }),
      subtitle: event.notes ?? null,
      amount:
        event.headChange !== 0
          ? `${event.headChange > 0 ? "+" : ""}${event.headChange} head · balance ${event.headAfter}`
          : `Balance ${event.headAfter}`,
      actor: event.createdBy?.name || event.createdBy?.email || "System",
    })),
    ...lot.treatments.map((treatment) => ({
      id: `treatment-${treatment.id}`,
      occurredAt: treatment.date,
      createdAt: treatment.createdAt,
      title: `Treatment logged: ${treatment.medicine}`,
      subtitle: treatment.notes ?? null,
      amount:
        treatment.billableAmount !== null
          ? `${treatment.headTreated ?? "Legacy"} head · $${treatment.billableAmount.toFixed(2)}`
          : `${treatment.headTreated ?? "Legacy"} head`,
      actor: "System",
    })),
  ].sort((a, b) => {
    const dateDiff = b.occurredAt.getTime() - a.occurredAt.getTime()
    if (dateDiff !== 0) return dateDiff
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  return (
    <main style={pageStyle}>
      <PageHeader
        title={lotLabel}
        subtitle="A single operational view of this lot, including weights, adjustments, treatments, activity, and current billing context."
        badge={lot.exitDate ? "Closed Lot" : "Open Lot"}
        rightSlot={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button href="/dashboard/stocker/lots" variant="secondary" size="sm">
              Back to Lots
            </Button>
            <Button href={`/dashboard/stocker/reports?ownerId=${lot.ownerId}&month=${monthValue}`} variant="secondary" size="sm">
              Owner Billing
            </Button>
          </div>
        }
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
        monthLabel={label}
      />

      <CardSection title="Lot Summary">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {[
            { label: "Owner", value: lot.owner.name },
            { label: "Pen", value: lot.pen.name },
            { label: "Current Head Count", value: lot.headCount.toString() },
            { label: "Status", value: lot.exitDate ? "Closed" : "Open" },
          ].map((item) => (
            <div key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, color: "var(--ink)", fontSize: 22, fontWeight: 700 }}>{item.value}</div>
            </div>
          ))}
        </div>
        <div style={{ ...stackStyle, marginTop: 16 }}>
          <div style={metaTextStyle}>
            Last adjustment: {lastAdjustment ? lastAdjustment.adjustmentDate.toLocaleDateString() : "No adjustments recorded"}
          </div>
          <div style={metaTextStyle}>
            Last treatment: {lastTreatment ? lastTreatment.date.toLocaleDateString() : "No treatments recorded"}
          </div>
          {lot.notes ? (
            <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>Lot Notes</div>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>{lot.notes}</p>
            </div>
          ) : null}
        </div>
      </CardSection>

      <CardSection title="Weight & Dates">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {[
            { label: "In Total Weight", value: formatTotalWeightLbs(lot.inTotalWeight) },
            { label: "Average In Weight", value: formatAverageWeightLbs(lot.inTotalWeight, lot.inHeadCount ?? lot.headCount) },
            { label: "Out Head Count", value: effectiveOutHeadCount?.toString() ?? "Not recorded" },
            { label: "Out Total Weight", value: formatTotalWeightLbs(lot.outTotalWeight) },
            { label: "Average Out Weight", value: formatAverageWeightLbs(lot.outTotalWeight, effectiveOutHeadCount) },
            { label: "Arrival Date", value: lot.arrivalDate.toLocaleDateString() },
            { label: "Exit Date", value: lot.exitDate ? lot.exitDate.toLocaleDateString() : "Open" },
          ].map((item) => (
            <div key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, color: "var(--ink)", fontSize: 18, fontWeight: 700 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </CardSection>

      <CardSection title="Adjustment History">
        {lot.adjustments.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No head count adjustments recorded for this lot.
          </div>
        ) : (
          <div style={stackStyle}>
            {lot.adjustments.map((adjustment) => (
              <div key={adjustment.id} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                      {adjustment.direction === "IN" ? "+" : "-"}
                      {adjustment.quantity} head · {getLotAdjustmentTypeLabel(adjustment.type)}
                    </div>
                    <div style={metaTextStyle}>
                      {adjustment.adjustmentDate.toLocaleDateString()} · {adjustment.createdBy?.name || adjustment.createdBy?.email || "System"}
                    </div>
                  </div>
                </div>
                {adjustment.notes ? <p style={{ marginBottom: 0, marginTop: 10, color: "var(--muted)" }}>{adjustment.notes}</p> : null}
              </div>
            ))}
          </div>
        )}
      </CardSection>

      <CardSection title="Treatment History">
        {lot.treatments.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No treatments logged for this lot yet.
          </div>
        ) : (
          <div style={stackStyle}>
            {lot.treatments.map((treatment) => {
              const unitLabel = treatment.medicineRecord?.unitLabel ?? "cc"

              return (
                <div key={treatment.id} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{treatment.medicine}</div>
                      <div style={metaTextStyle}>{treatment.date.toLocaleDateString()}</div>
                    </div>
                    {treatment.billableAmount !== null ? (
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>${treatment.billableAmount.toFixed(2)}</div>
                    ) : null}
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 8 }}>
                    Head treated: {treatment.headTreated ?? "Legacy"} · Dose: {treatment.dosePerHead} {unitLabel} · Total used: {treatment.totalUnitsUsed?.toFixed(2) ?? "—"} {unitLabel}
                  </div>
                  {treatment.costPerUnitSnapshot !== null ? (
                    <div style={{ ...metaTextStyle, marginTop: 6 }}>
                      Cost snapshot: ${treatment.costPerUnitSnapshot.toFixed(2)} / {unitLabel}
                    </div>
                  ) : null}
                  {treatment.notes ? <p style={{ marginBottom: 0, marginTop: 10, color: "var(--muted)" }}>{treatment.notes}</p> : null}
                </div>
              )
            })}
          </div>
        )}
      </CardSection>

      <CardSection title="Canonical Timeline">
        {timelineEntries.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No dated history has been logged for this lot yet.
          </div>
        ) : (
          <div style={stackStyle}>
            {timelineEntries.map((entry) => (
              <div key={entry.id} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                  {entry.title}
                </div>
                <div style={{ ...metaTextStyle, marginTop: 8 }}>
                  {entry.occurredAt.toLocaleDateString()} · {entry.actor}
                </div>
                <div style={{ ...metaTextStyle, marginTop: 6 }}>{entry.amount}</div>
                {entry.subtitle ? <p style={{ marginBottom: 0, marginTop: 10, color: "var(--muted)" }}>{entry.subtitle}</p> : null}
              </div>
            ))}
          </div>
        )}
      </CardSection>

      <CardSection title="Billing Context">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
            <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>Head-Days This Month</div>
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>{headDaysThisMonth}</div>
            <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              Calculated from dated lot ledger events across {label}.
            </p>
          </div>
          <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
            <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>Treatment Charges This Month</div>
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>${treatmentChargesThisMonth.toFixed(2)}</div>
            <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              Includes owner markup when the treatment billing mode allows it.
            </p>
          </div>
          <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
            <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>Yardage Estimate This Month</div>
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>${yardageEstimate.toFixed(2)}</div>
            <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              {lot.owner.yardageRatePerHeadDay === null
                ? "Owner yardage rate is not set."
                : `$${lot.owner.yardageRatePerHeadDay.toFixed(2)} per head-day for ${lot.owner.name}.`}
            </p>
          </div>
        </div>
        <div style={{ ...stackStyle, marginTop: 16 }}>
          <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)" }}>Owner Billing Notes</div>
            <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              {lot.owner.billingNotes?.trim() || "No billing notes saved for this owner."}
            </p>
          </div>
        </div>
      </CardSection>
    </main>
  )
}
