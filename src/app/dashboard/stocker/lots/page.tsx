import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { LotLedgerEventType, ModuleKey, StockerActivityType } from "@prisma/client"
import { logStockerActivity } from "@/lib/stocker-activity"
import { recordLotLedgerEvent } from "@/lib/stocker-ledger"
import {
  formatAverageWeightLbs,
  formatLotLabel,
  formatTotalWeightLbs,
} from "@/lib/stocker-labels"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import {
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  toDateInputValue,
} from "@/lib/stocker"
import { getEffectiveOutHeadCount } from "@/lib/stocker-weights"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  metaTextStyle,
  pageStyle,
  stackStyle,
} from "@/lib/stocker-ui"

export default async function LotsPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId

  const [owners, pens, lots] = await Promise.all([
    prisma.owner.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.pen.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lot.findMany({
      where: { organizationId: orgId },
      orderBy: [{ exitDate: "asc" }, { arrivalDate: "desc" }],
      select: {
        id: true,
        headCount: true,
        inHeadCount: true,
        inTotalWeight: true,
        outHeadCount: true,
        outTotalWeight: true,
        arrivalDate: true,
        exitDate: true,
        notes: true,
        ownerId: true,
        penId: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
        adjustments: {
          orderBy: [{ adjustmentDate: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            id: true,
            type: true,
            direction: true,
            quantity: true,
            adjustmentDate: true,
            notes: true,
          },
        },
        _count: {
          select: {
            treatments: true,
            moves: true,
            adjustments: true,
          },
        },
      },
    }),
  ])
  const activeLots = lots.filter((lot) => !lot.exitDate)
  const closedLots = lots.filter((lot) => !!lot.exitDate)
  const totalOpenHead = activeLots.reduce((sum, lot) => sum + lot.headCount, 0)
  const lotsNeedingWeightBackfill = activeLots.filter((lot) => lot.inTotalWeight === null).length

  async function createLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const ownerId = formData.get("ownerId")?.toString()
    const penId = formData.get("penId")?.toString()
    const headCount = parseNumberInput(formData.get("headCount"))
    const inTotalWeight = parseNumberInput(formData.get("inTotalWeight"))
    const arrivalDate = parseDateInput(formData.get("arrivalDate"))
    const notes = formData.get("notes")?.toString().trim() || null

    if (!ownerId || !penId || !headCount || !arrivalDate) return
    if (!Number.isInteger(headCount) || headCount <= 0) return

    const [owner, pen] = await Promise.all([
      prisma.owner.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true, name: true } }),
      prisma.pen.findFirst({ where: { id: penId, organizationId: orgId }, select: { id: true, name: true } }),
    ])

    if (!owner || !pen) return

    await prisma.$transaction(async (tx) => {
      const lot = await tx.lot.create({
        data: {
          organizationId: orgId,
          ownerId,
          penId,
          headCount,
          inHeadCount: headCount,
          inTotalWeight,
          arrivalDate,
          notes,
        },
      })

      await recordLotLedgerEvent(
        {
          organizationId: orgId,
          lotId: lot.id,
          eventType: LotLedgerEventType.INTAKE,
          eventDate: arrivalDate,
          headChange: headCount,
          headAfter: headCount,
          notes,
          createdById: core.user.id,
          relatedOwnerId: ownerId,
          relatedPenId: penId,
          metadata: {
            ownerId,
            ownerName: owner.name,
            penId,
            penName: pen.name,
            headCount,
            inHeadCount: headCount,
            inTotalWeight,
            arrivalDate: arrivalDate.toISOString(),
          },
        },
        tx,
      )

      await logStockerActivity(
        {
          organizationId: orgId,
          type: StockerActivityType.INTAKE,
          message: `${headCount} head received for ${owner.name} into ${pen.name}.`,
          metadata: {
            lotId: lot.id,
            ownerId,
            ownerName: owner.name,
            penId,
            penName: pen.name,
            headCount,
            inHeadCount: headCount,
            inTotalWeight,
            arrivalDate: arrivalDate.toISOString(),
          },
          createdByUserId: core.user.id,
        },
        tx,
      )
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function deleteLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const lotId = formData.get("lotId")?.toString()
    if (!lotId) return

    await prisma.lot.deleteMany({
      where: {
        id: lotId,
        organizationId: orgId,
      },
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Work Lots"
        subtitle="Run the main yard workflow here: receive cattle, work open lots, transfer cattle, and close lots cleanly."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
      />
      <ActionBar
        primaryAction={{ href: "/dashboard/stocker/quick/intake?returnTo=%2Fdashboard%2Fstocker%2Flots", label: "Receive Cattle" }}
        secondaryActions={[
          { href: "#active-lots", label: "Work Open Lots" },
          { href: "/dashboard/stocker/quick/adjust?returnTo=%2Fdashboard%2Fstocker%2Flots", label: "Adjust Head Count" },
          { href: "/dashboard/stocker/quick/move-split", label: "Split / Transfer" },
        ]}
      />

      <CardSection title="Lot Workflow">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 16 }}>
          {[
            { label: "1. Receive Cattle", note: "Start a new lot with owner, pen, head count, and total in weight." },
            { label: "2. Work Open Lots", note: "Keep counts right, capture changes, and route cattle where they belong." },
            { label: "3. Close Out", note: "Finish the lot with out head count, out weight, and billing handoff." },
          ].map((item) => (
            <article key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>{item.label}</div>
              <p style={{ margin: "10px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>{item.note}</p>
            </article>
          ))}
        </div>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {[
            { label: "Active Lots", value: `${activeLots.length}`, note: "Lots currently driving daily work." },
            { label: "Open Head", value: `${totalOpenHead}`, note: "Head currently represented in open lots." },
            { label: "Closed Lots", value: `${closedLots.length}`, note: "Historical lots moved out of the main workflow." },
            {
              label: "Weight Follow-Up",
              value: `${lotsNeedingWeightBackfill}`,
              note: lotsNeedingWeightBackfill > 0 ? "Open lots still missing total in weight." : "All open lots have intake weight on file.",
            },
          ].map((item) => (
            <article key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>{item.value}</div>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>{item.note}</p>
            </article>
          ))}
        </div>
      </CardSection>

      <CardSection id="intake-lot" title="Receive Cattle">
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <article className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>Quick Intake</div>
              <p style={{ margin: "10px 0 14px", color: "var(--muted)", lineHeight: 1.6 }}>
                Use the fast receiving form when you just need owner, pen, head count, arrival date, and total in weight.
              </p>
              <Button href="/dashboard/stocker/quick/intake?returnTo=%2Fdashboard%2Fstocker%2Flots" variant="secondary" size="sm">
                Open Quick Intake
              </Button>
            </article>
            <article className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>Full Intake Fallback</div>
              <p style={{ margin: "10px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>
                Keep the full intake form below for slower office entry or backfill work. Daily receiving should usually start in Quick Intake.
              </p>
            </article>
          </div>
        {owners.length === 0 || pens.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Create at least one owner and one pen before adding lots.
          </div>
        ) : (
          <details className="stocker-disclosure">
            <summary>Open full intake form</summary>
            <div className="stocker-disclosure__body">
              <form action={createLot} style={stackStyle}>
                <div style={gridStyle}>
                  <Select label="Owner" name="ownerId" defaultValue="" style={inputStyle}>
                    <option value="" disabled>
                      Select owner
                    </option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </Select>
                  <Select label="Pen" name="penId" defaultValue="" style={inputStyle}>
                    <option value="" disabled>
                      Select pen
                    </option>
                    {pens.map((pen) => (
                      <option key={pen.id} value={pen.id}>
                        {pen.name}
                      </option>
                    ))}
                  </Select>
                  <Input label="Head count" name="headCount" inputMode="numeric" style={inputStyle} />
                  <Input
                    label="Total In Weight (lbs)"
                    name="inTotalWeight"
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    style={inputStyle}
                  />
                  <Input label="Arrival date" name="arrivalDate" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
                </div>
                <Textarea label="Notes" name="notes" placeholder="Notes" rows={3} style={inputStyle} />
                <div>
                  <Button type="submit" variant="primary">
                    Save Lot
                  </Button>
                </div>
              </form>
            </div>
          </details>
        )}
        </div>
      </CardSection>

      <CardSection id="active-lots" title="Work Open Lots">
        {activeLots.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No open lots right now.</strong>
            Intake your first lot to begin tracking cattle.
          </div>
        ) : (
          <div style={stackStyle}>
            {activeLots.map((lot) => {
              const effectiveOutHeadCount = getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount)

              return (
                <article key={lot.id} className="stocker-card" style={cardStyle}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <strong style={{ color: "var(--stocker-navy)" }}>
                        {formatLotLabel({
                          ownerName: lot.owner.name,
                          penName: lot.pen.name,
                          arrivalDate: lot.arrivalDate,
                        })}
                      </strong>
                      <Button href={`/dashboard/stocker/lots/${lot.id}`} variant="secondary" size="sm">
                        View Lot Detail
                      </Button>
                      {!lot.exitDate ? (
                        <Button href={`/dashboard/stocker/lots/${lot.id}/closeout`} variant="secondary" size="sm">
                          Closeout Review
                        </Button>
                      ) : null}
                    </div>
                    <div style={metaTextStyle}>
                      Current head count: {lot.headCount} | Status: Open | Arrival: {lot.arrivalDate.toLocaleDateString()}
                    </div>
                    <div style={metaTextStyle}>
                      In total: {formatTotalWeightLbs(lot.inTotalWeight)} | Avg in:{" "}
                      {formatAverageWeightLbs(lot.inTotalWeight, lot.inHeadCount ?? lot.headCount)}
                    </div>
                    <div style={metaTextStyle}>
                      Out head count: {effectiveOutHeadCount ?? "Not recorded"} | Out total: {formatTotalWeightLbs(lot.outTotalWeight)} | Avg out:{" "}
                      {formatAverageWeightLbs(lot.outTotalWeight, effectiveOutHeadCount)}
                    </div>
                    <div style={metaTextStyle}>
                      Last adjustment: {lot.adjustments[0] ? lot.adjustments[0].adjustmentDate.toLocaleDateString() : "None"}
                    </div>
                    <div style={metaTextStyle}>
                      Treatments: {lot._count.treatments} | Moves: {lot._count.moves} | Adjustments: {lot._count.adjustments}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                    <Button href={`/dashboard/stocker/lots/${lot.id}`} variant="secondary" size="sm">
                      View Lot Detail
                    </Button>
                    <Button href={`/dashboard/stocker/quick/adjust?returnTo=${encodeURIComponent("/dashboard/stocker/lots")}`} variant="secondary" size="sm">
                      Adjust Head Count
                    </Button>
                    <Button href={`/dashboard/stocker/lots/${lot.id}/closeout`} variant="secondary" size="sm">
                      Closeout Review
                    </Button>
                    <Button href={`/dashboard/stocker/quick/move-split?returnTo=${encodeURIComponent("/dashboard/stocker/lots")}`} variant="secondary" size="sm">
                      Split / Transfer
                    </Button>
                  </div>

                  <details className="stocker-disclosure">
                    <summary>Recent count changes and archive actions</summary>
                    <div className="stocker-disclosure__body" style={stackStyle}>
                      <div>
                        <div style={{ ...metaTextStyle, marginBottom: 8 }}>Recent adjustments</div>
                        {lot.adjustments.length === 0 ? (
                          <div style={metaTextStyle}>No head count adjustments recorded yet.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {lot.adjustments.map((adjustment) => (
                              <div key={adjustment.id} style={{ borderTop: "1px solid rgba(11, 45, 69, 0.08)", paddingTop: 8 }}>
                                <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>
                                  {adjustment.direction === "IN" ? "+" : "-"}
                                  {adjustment.quantity} head
                                </div>
                                <div style={metaTextStyle}>
                                  {adjustment.adjustmentDate.toLocaleDateString()}
                                  {adjustment.notes ? ` | ${adjustment.notes}` : ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={metaTextStyle}>
                        Edit arrival date, weights, exit details, and notes from the lot detail page.
                      </div>

                      <form action={deleteLot}>
                        <input type="hidden" name="lotId" value={lot.id} />
                        <Button type="submit" variant="secondary">
                          Delete Lot
                        </Button>
                      </form>
                    </div>
                  </details>
                </article>
              )
            })}
          </div>
        )}
      </CardSection>

      <CardSection title="Closed Lot Archive">
        {closedLots.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No closed lots are archived yet.
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
              View {closedLots.length} closed lot{closedLots.length === 1 ? "" : "s"}
            </summary>
            <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
              {closedLots.map((lot) => {
                const effectiveOutHeadCount = getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount)

                return (
                  <article key={lot.id} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <strong style={{ color: "var(--stocker-navy)" }}>
                        {formatLotLabel({
                          ownerName: lot.owner.name,
                          penName: lot.pen.name,
                          arrivalDate: lot.arrivalDate,
                        })}
                      </strong>
                      <Button href={`/dashboard/stocker/lots/${lot.id}`} variant="secondary" size="sm">
                        View Lot Detail
                      </Button>
                    </div>
                    <div style={{ ...metaTextStyle, marginTop: 8 }}>
                      Closed {lot.exitDate?.toLocaleDateString()} · Out head count: {effectiveOutHeadCount ?? "Not recorded"} · Out total: {formatTotalWeightLbs(lot.outTotalWeight)}
                    </div>
                  </article>
                )
              })}
            </div>
          </details>
        )}
      </CardSection>
    </main>
  )
}
