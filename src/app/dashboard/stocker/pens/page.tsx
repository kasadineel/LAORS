import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Table } from "@/components/stocker/ui/Table"
import { Input } from "@/components/stocker/ui/Input"
import { ModuleKey } from "@prisma/client"
import { formatLotLabel } from "@/lib/stocker-labels"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireStockerAccess } from "@/lib/stocker"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  metaTextStyle,
  pageStyle,
  stackStyle,
  tableContainerStyle,
} from "@/lib/stocker-ui"

export default async function PensPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId
  const today = new Date()

  const [pens, feedEntries, treatments] = await Promise.all([
    prisma.pen.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        capacity: true,
        lots: {
          where: {
            arrivalDate: { lte: today },
            OR: [{ exitDate: null }, { exitDate: { gte: today } }],
          },
          select: {
            id: true,
            headCount: true,
            arrivalDate: true,
            owner: { select: { name: true } },
          },
        },
        feedAllocationRules: {
          where: {
            effectiveStartDate: { lte: today },
            OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: today } }],
          },
          select: {
            ownerId: true,
            allocationPercent: true,
          },
        },
        _count: {
          select: {
            lots: true,
            outgoingMoves: true,
            incomingMoves: true,
          },
        },
      },
    }),
    prisma.feedEntry.findMany({
      where: { organizationId: orgId },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      select: {
        penId: true,
        entryDate: true,
      },
    }),
    prisma.treatment.findMany({
      where: { lot: { organizationId: orgId } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        date: true,
        lot: { select: { penId: true } },
      },
    }),
  ])

  const latestFeedByPen = new Map<string, Date>()
  for (const entry of feedEntries) {
    if (!latestFeedByPen.has(entry.penId)) {
      latestFeedByPen.set(entry.penId, entry.entryDate)
    }
  }

  const latestTreatmentByPen = new Map<string, Date>()
  for (const treatment of treatments) {
    if (!latestTreatmentByPen.has(treatment.lot.penId)) {
      latestTreatmentByPen.set(treatment.lot.penId, treatment.date)
    }
  }

  const penBoardRows = pens.map((pen) => {
    const occupancy = pen.lots.reduce((sum, lot) => sum + lot.headCount, 0)
    const ownerNames = [...new Set(pen.lots.map((lot) => lot.owner.name))]
    const requiresAllocationRules = ownerNames.length > 1
    const allocationTotal = pen.feedAllocationRules.reduce((sum, rule) => sum + rule.allocationPercent, 0)
    const allocationHealthy = !requiresAllocationRules || Math.abs(allocationTotal - 100) <= 0.25

    return {
      id: pen.id,
      name: pen.name,
      capacity: pen.capacity,
      occupancy,
      ownerNames,
      activeLots: pen.lots,
      latestFeedDate: latestFeedByPen.get(pen.id) ?? null,
      latestTreatmentDate: latestTreatmentByPen.get(pen.id) ?? null,
      requiresAllocationRules,
      allocationHealthy,
      allocationTotal,
    }
  })
  const occupiedPens = penBoardRows.filter((pen) => pen.occupancy > 0).length
  const sharedPens = penBoardRows.filter((pen) => pen.requiresAllocationRules).length
  const pensNeedingAllocation = penBoardRows.filter((pen) => pen.requiresAllocationRules && !pen.allocationHealthy).length

  async function createPen(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })
    const name = formData.get("name")?.toString().trim()
    const capacityRaw = formData.get("capacity")?.toString().trim()
    const capacity = capacityRaw ? Number(capacityRaw) : null

    if (!name) return
    if (capacityRaw && !Number.isInteger(capacity)) return

    await prisma.pen.create({
      data: {
        organizationId: orgId,
        name,
        capacity,
      },
    })

    revalidatePath("/dashboard/stocker/pens")
  }

  async function updatePen(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })
    const penId = formData.get("penId")?.toString()
    const name = formData.get("name")?.toString().trim()
    const capacityRaw = formData.get("capacity")?.toString().trim()
    const capacity = capacityRaw ? Number(capacityRaw) : null

    if (!penId || !name) return
    if (capacityRaw && !Number.isInteger(capacity)) return

    await prisma.pen.updateMany({
      where: { id: penId, organizationId: orgId },
      data: {
        name,
        capacity,
      },
    })

    revalidatePath("/dashboard/stocker/pens")
  }

  async function deletePen(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })
    const penId = formData.get("penId")?.toString()
    if (!penId) return

    const pen = await prisma.pen.findFirst({
      where: { id: penId, organizationId: orgId },
      select: {
        _count: {
          select: {
            lots: true,
            outgoingMoves: true,
            incomingMoves: true,
          },
        },
      },
    })

    if (
      !pen ||
      pen._count.lots > 0 ||
      pen._count.outgoingMoves > 0 ||
      pen._count.incomingMoves > 0
    ) {
      return
    }

    await prisma.pen.deleteMany({
      where: { id: penId, organizationId: orgId },
    })

    revalidatePath("/dashboard/stocker/pens")
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Pens"
        subtitle="Use the yard board to see live occupancy first. Open pen setup only when you need to maintain names or capacity."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
      />
      <ActionBar
        primaryAction={{ href: "/dashboard/stocker/feed", label: "Feed Yard" }}
        secondaryActions={[
          { href: "#live-yard-board", label: "Live Yard Board" },
          { href: "#pen-setup", label: "Pen Setup" },
        ]}
      />

      <CardSection title="Pen Priorities">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {[
            { label: "Pens in Use", value: `${occupiedPens}`, note: "Pens with active cattle on feed today." },
            { label: "Shared Pens", value: `${sharedPens}`, note: "Pens carrying more than one owner." },
            { label: "Allocation Issues", value: `${pensNeedingAllocation}`, note: pensNeedingAllocation > 0 ? "Shared pens that need feed rule cleanup." : "Shared-pen feed allocation is currently clean." },
          ].map((item) => (
            <article key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>{item.value}</div>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>{item.note}</p>
            </article>
          ))}
        </div>
      </CardSection>

      <CardSection id="live-yard-board" title="Live Yard Board">
        <p style={{ ...metaTextStyle, marginTop: 0, marginBottom: 16, lineHeight: 1.7 }}>
          This is the live pen view. Use it to confirm occupancy, mixed-owner pens, and whether feed or treatment tracking looks current.
        </p>
        {penBoardRows.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No pens exist yet. Create a pen to start tracking occupancy and live yard flow.
          </div>
        ) : (
          <>
            <div className="stocker-mobile-cards" style={stackStyle}>
              {penBoardRows.map((row) => (
                <article key={row.id} className="stocker-card" style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <strong style={{ color: "var(--ink)" }}>{row.name}</strong>
                    <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                      {row.occupancy}{row.capacity ? ` / ${row.capacity}` : ""} hd
                    </div>
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 8 }}>
                    Owners: {row.ownerNames.length > 0 ? row.ownerNames.join(", ") : "No active lots"}
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>
                    Last feed: {row.latestFeedDate ? row.latestFeedDate.toLocaleDateString() : "No feed logged"}
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>
                    Last treatment: {row.latestTreatmentDate ? row.latestTreatmentDate.toLocaleDateString() : "No treatment logged"}
                  </div>
                  {row.activeLots.length > 0 ? (
                    <div style={{ ...metaTextStyle, marginTop: 8, lineHeight: 1.6 }}>
                      {row.activeLots
                        .slice(0, 2)
                        .map((lot) =>
                          formatLotLabel({
                            ownerName: lot.owner.name,
                            penName: row.name,
                            arrivalDate: lot.arrivalDate,
                          }),
                        )
                        .join(" · ")}
                    </div>
                  ) : null}
                  {row.requiresAllocationRules && !row.allocationHealthy ? (
                    <div style={{ ...metaTextStyle, marginTop: 8, color: "var(--primary)" }}>
                      Feed allocation rules total {row.allocationTotal.toFixed(2)}% for this shared pen.
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <Table className="stocker-desktop-table" style={tableContainerStyle}>
              <thead>
                <tr>
                  <th style={{ padding: "8px 0" }}>Pen</th>
                  <th style={{ padding: "8px 0" }} data-align="right">Head Count</th>
                  <th style={{ padding: "8px 0" }}>Owner Breakdown</th>
                  <th style={{ padding: "8px 0" }}>Operational Health</th>
                </tr>
              </thead>
              <tbody>
                {penBoardRows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ padding: "12px 0", fontWeight: 700 }}>{row.name}</td>
                    <td style={{ padding: "12px 0" }} data-align="right">
                      {row.occupancy}{row.capacity ? ` / ${row.capacity}` : ""}
                    </td>
                    <td style={{ padding: "12px 0" }}>
                      {row.activeLots.length === 0
                        ? "No active lots"
                        : row.activeLots
                            .map((lot) =>
                              `${lot.owner.name} (${lot.headCount})`,
                            )
                            .join(", ")}
                    </td>
                    <td style={{ padding: "12px 0" }}>
                      <div>Feed: {row.latestFeedDate ? row.latestFeedDate.toLocaleDateString() : "No feed logged"}</div>
                      <div>Treatment: {row.latestTreatmentDate ? row.latestTreatmentDate.toLocaleDateString() : "No treatment logged"}</div>
                      <div style={{ color: row.requiresAllocationRules && !row.allocationHealthy ? "var(--primary)" : "var(--muted)" }}>
                        {row.requiresAllocationRules
                          ? row.allocationHealthy
                            ? "Shared pen allocation ready"
                            : `Shared pen rules total ${row.allocationTotal.toFixed(2)}%`
                          : "Single-owner pen"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </CardSection>

      <CardSection id="pen-setup" title="Pen Setup">
        <details className="stocker-disclosure">
          <summary>Open pen creation and capacity management</summary>
          <div className="stocker-disclosure__body" style={{ display: "grid", gap: 18 }}>
            <form action={createPen} style={{ ...stackStyle, maxWidth: 720 }}>
              <div style={gridStyle}>
                <Input label="Pen Name" name="name" placeholder="West Bimerly" required style={inputStyle} />
                <Input label="Capacity" name="capacity" placeholder="120" inputMode="numeric" style={inputStyle} />
              </div>
              <div>
                <Button type="submit" variant="primary">
                  Save Pen
                </Button>
              </div>
            </form>

            {pens.length === 0 ? (
              <div className="stocker-empty-state" style={emptyStateStyle}>
                <strong style={{ display: "block", marginBottom: 8 }}>No pens yet.</strong>
                Create your first pen to start organizing cattle flow across the yard.
              </div>
            ) : (
              <div style={stackStyle}>
                {pens.map((pen) => (
                  <details key={pen.id} className="stocker-disclosure">
                    <summary>{pen.name}</summary>
                    <div className="stocker-disclosure__body">
                    <article className="stocker-card" style={cardStyle}>
                    <form action={updatePen} style={stackStyle}>
                      <input type="hidden" name="penId" value={pen.id} />
                      <div style={metaTextStyle}>
                        Lots: {pen._count.lots} | Moves: {pen._count.outgoingMoves + pen._count.incomingMoves}
                      </div>
                      <div style={gridStyle}>
                        <Input label="Pen Name" name="name" defaultValue={pen.name} style={inputStyle} />
                        <Input
                          label="Capacity"
                          name="capacity"
                          defaultValue={pen.capacity ?? ""}
                          inputMode="numeric"
                          style={inputStyle}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button type="submit" variant="primary">
                          Update
                        </Button>
                      </div>
                    </form>

                    <form action={deletePen} style={{ marginTop: 10 }}>
                      <input type="hidden" name="penId" value={pen.id} />
                      <Button type="submit" variant="secondary">
                        Delete
                      </Button>
                    </form>
                  </article>
                  </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </details>
      </CardSection>
    </main>
  )
}
