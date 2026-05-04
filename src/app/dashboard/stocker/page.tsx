import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { CardSection } from "@/components/stocker/CardSection"
import { DashboardFiltersForm } from "@/components/stocker/dashboard-filters-form"
import { StatCard } from "@/components/stocker/stat-card"
import { Button } from "@/components/stocker/ui/Button"
import { Card } from "@/components/stocker/ui/Card"
import { Table } from "@/components/stocker/ui/Table"
import { formatStockerActivityMessage } from "@/lib/stocker-labels"
import { getInvoiceSummaryForWindow } from "@/lib/stocker-billing"
import { calculateHeadDaysFromLedger } from "@/lib/stocker-ledger"
import { getStockerActivityDelegate, prisma } from "@/lib/prisma"
import { canManageStocker, getRoleDisplayName } from "@/lib/permissions"
import { getMonthWindow, requireStockerAccess } from "@/lib/stocker"
import {
  cardStyle,
  emptyStateStyle,
  metaTextStyle,
  pageHeaderStyle,
  pageStyle,
  splitHeaderStyle,
  tableContainerStyle,
} from "@/lib/stocker-ui"

type StockerDashboardPageProps = {
  searchParams?:
    | Promise<{ month?: string | string[]; includeClosed?: string | string[] }>
    | { month?: string | string[]; includeClosed?: string | string[] }
}

export default async function StockerDashboardPage({ searchParams }: StockerDashboardPageProps) {
  const core = await requireStockerAccess()
  const canManage = canManageStocker(core.role)
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const monthParam = Array.isArray(resolvedSearchParams.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams.month
  const includeClosedParam = Array.isArray(resolvedSearchParams.includeClosed)
    ? resolvedSearchParams.includeClosed[0]
    : resolvedSearchParams.includeClosed
  const { monthStart, monthEnd, monthValue, label } = getMonthWindow(monthParam)
  const orgId = core.activeOrganizationId
  const today = new Date()
  const includeClosed = includeClosedParam === "1"
  const stockerActivity = getStockerActivityDelegate()

  const [owners, lotsForMonth, inventoryLots, invoiceSummary, recentActivities] = await Promise.all([
    prisma.owner.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lot.findMany({
      where: {
        organizationId: orgId,
        arrivalDate: { lt: monthEnd },
        OR: [{ exitDate: null }, { exitDate: { gte: monthStart } }],
      },
      select: {
        id: true,
        ownerId: true,
        headCount: true,
        arrivalDate: true,
        exitDate: true,
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
    prisma.lot.findMany({
      where: includeClosed
        ? { organizationId: orgId }
        : {
            organizationId: orgId,
            arrivalDate: { lte: today },
            OR: [{ exitDate: null }, { exitDate: { gte: today } }],
          },
      select: {
        id: true,
        ownerId: true,
        penId: true,
        headCount: true,
        arrivalDate: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
      },
    }),
    getInvoiceSummaryForWindow({
      organizationId: orgId,
      monthStart,
      monthEnd,
      monthValue,
    }),
    stockerActivity.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        message: true,
        metadata: true,
        createdAt: true,
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
  ])

  const ownerSnapshotRows = owners
    .map((owner) => {
      const lots = inventoryLots.filter((lot) => lot.ownerId === owner.id)
      const headCount = lots.reduce((sum, lot) => sum + lot.headCount, 0)
      const penNames = [...new Set(lots.map((lot) => lot.pen.name))]
      const oldestArrival = lots.reduce<Date | null>(
        (oldest, lot) => (!oldest || lot.arrivalDate < oldest ? lot.arrivalDate : oldest),
        null,
      )

      return {
        id: owner.id,
        name: owner.name,
        headCount,
        penNames,
        oldestArrival,
      }
    })
    .filter((row) => row.headCount > 0)

  const penSnapshotRows = [...new Map(inventoryLots.map((lot) => [lot.penId, lot.pen.name])).entries()]
    .map(([penId, penName]) => {
      const lots = inventoryLots.filter((lot) => lot.penId === penId)
      const headCount = lots.reduce((sum, lot) => sum + lot.headCount, 0)
      const ownerBreakdown = [...new Map(lots.map((lot) => [lot.ownerId, lot.owner.name])).entries()]
        .map(([ownerId, ownerName]) => ({
          ownerId,
          ownerName,
          headCount: lots
            .filter((lot) => lot.ownerId === ownerId)
            .reduce((sum, lot) => sum + lot.headCount, 0),
        }))
        .sort((a, b) => b.headCount - a.headCount)

      return {
        id: penId,
        name: penName,
        headCount,
        ownerBreakdown,
      }
    })
    .filter((row) => row.headCount > 0)

  const ownerRows = owners.map((owner) => {
    const inventory = inventoryLots
      .filter((lot) => lot.ownerId === owner.id)
      .reduce((sum, lot) => sum + lot.headCount, 0)

    const headDays = lotsForMonth
      .filter((lot) => lot.ownerId === owner.id)
      .reduce(
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

    const invoiceTotal = invoiceSummary.invoices
      .filter((invoice) => invoice.ownerId === owner.id)
      .reduce((sum, invoice) => sum + invoice.total, 0)

    return {
      id: owner.id,
      name: owner.name,
      inventory,
      headDays,
      invoiceTotal,
    }
  })

  const totals = ownerRows.reduce(
    (sum, row) => ({
      inventory: sum.inventory + row.inventory,
      headDays: sum.headDays + row.headDays,
      invoiceTotal: sum.invoiceTotal + row.invoiceTotal,
    }),
    { inventory: 0, headDays: 0, invoiceTotal: 0 },
  )
  const activeLotCount = inventoryLots.length
  const sharedPenCount = penSnapshotRows.filter((row) => row.ownerBreakdown.length > 1).length
  const latestActivity = recentActivities[0] ?? null
  const invoiceSummaryDescription =
    invoiceSummary.invoiceCount > 0
      ? `${invoiceSummary.invoiceCount} non-void invoice${invoiceSummary.invoiceCount === 1 ? "" : "s"} matched ${label}: ${invoiceSummary.invoiceStatusCounts.draft} draft, ${invoiceSummary.invoiceStatusCounts.finalized} finalized.`
      : `No draft or finalized invoices matched ${label}. Voided invoices are excluded from this total.`
  const monthlySummaryText =
    ownerRows.length > 0
      ? `${ownerRows.length} owner${ownerRows.length === 1 ? "" : "s"} contributed to ${totals.headDays.toLocaleString()} head-days in ${label}.`
      : `No owner activity overlaps ${label} yet.`
  const attentionItems = [
    ...(invoiceSummary.invoiceStatusCounts.draft > 0
      ? [`${invoiceSummary.invoiceStatusCounts.draft} draft invoice${invoiceSummary.invoiceStatusCounts.draft === 1 ? " is" : "s are"} waiting for review or finalization.`]
      : []),
    ...(sharedPenCount > 0
      ? [`${sharedPenCount} shared pen${sharedPenCount === 1 ? " is" : "s are"} active. Confirm feed allocation rules before month-end.`]
      : []),
    ...(totals.inventory === 0 ? ["No open inventory is showing in the current filter."] : []),
    ...(recentActivities.length === 0 ? ["No recent operating activity has been logged yet."] : []),
  ]

  return (
    <main style={pageStyle}>
      <div style={pageHeaderStyle}>
        <div style={{ flex: "1 1 100%" }}>
          <PageHeader
            title="Operations Overview"
            subtitle={`Use this page as the yard workboard for ${label}: what is on feed, what needs attention, and which job should happen next.`}
            badge="Stocker Command Center"
          />
          <StatusRow
            organizationName={core.organization.name}
            roleLabel={getRoleDisplayName(core.role)}
            monthLabel={label}
          />
        </div>
      </div>

      <CardSection title="Today’s Workboard">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {[
            {
              title: "Receive Cattle",
              note: "Start new arrivals, capture head count, and lock in intake weights.",
              href: "/dashboard/stocker/lots#intake-lot",
            },
            {
              title: "Work Open Lots",
              note: "Adjust counts, transfer cattle, and move open inventory toward closeout.",
              href: "/dashboard/stocker/lots#active-lots",
            },
            {
              title: "Treat & Feed",
              note: "Handle the two daily chores that drive cost and lot condition.",
              href: "/dashboard/stocker/feed",
            },
            {
              title: "Review Billing",
              note: "Confirm the month, then issue or finalize billing documents.",
              href: "/dashboard/stocker/reports",
            },
          ].map((item) => (
            <Card key={item.title} style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>{item.title}</div>
              <p style={{ margin: "10px 0 14px", color: "var(--muted)", lineHeight: 1.7 }}>{item.note}</p>
              <Button href={item.href} variant="secondary" size="sm">
                Open
              </Button>
            </Card>
          ))}
        </div>
      </CardSection>

      <section
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          marginTop: 18,
        }}
      >
        <StatCard
          label="Open Inventory"
          value={`${totals.inventory}`}
          description="Head currently on feed in the active view."
        />
        <StatCard
          label="Active Lots"
          value={`${activeLotCount}`}
          description="Lots currently driving inventory and daily work."
        />
        <StatCard
          label="Head-Days"
          value={`${totals.headDays}`}
          description={`Ledger-based for lots overlapping ${label}.`}
        />
        <StatCard
          label="Invoice Total"
          value={`$${invoiceSummary.invoiceTotal.toFixed(2)}`}
          description={invoiceSummaryDescription}
        />
      </section>

      <Card
        style={{
          ...cardStyle,
          marginTop: 24,
          padding: 18,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 18,
            alignItems: "start",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                ...metaTextStyle,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Current Month
            </div>
            <h2 style={{ margin: 0, color: "var(--ink)" }}>{label} operating view</h2>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.7 }}>
              {monthlySummaryText} Active invoice totals on this page include draft and finalized invoices only. Voided invoices stay out of current operating totals.
            </p>
            {latestActivity ? (
              <div
                style={{
                  paddingTop: 12,
                  borderTop: "1px solid rgba(16, 42, 67, 0.08)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...metaTextStyle, fontWeight: 700 }}>Latest activity</div>
                  <div style={{ color: "var(--ink)", fontWeight: 600, lineHeight: 1.5 }}>
                    {formatStockerActivityMessage(latestActivity)}
                  </div>
                  <div style={metaTextStyle}>
                    {latestActivity.createdAt.toLocaleString()} by{" "}
                    {latestActivity.createdBy?.name || latestActivity.createdBy?.email || "System"}
                  </div>
                </div>
                <Button href="#recent-activity" variant="ghost" size="sm">
                  View History
                </Button>
              </div>
            ) : null}
          </div>

          <div style={{ width: "100%" }}>
            <DashboardFiltersForm monthValue={monthValue} includeClosed={includeClosed} />
          </div>
        </div>
      </Card>

      <CardSection title="Needs Attention">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <Card style={{ ...cardStyle, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)" }}>Work in this order</div>
            <div style={{ ...metaTextStyle, marginTop: 8, lineHeight: 1.7 }}>
              Clean up lot work first, then make sure feed and treatments are logged, then move into billing review.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <Button href="/dashboard/stocker/lots#active-lots" variant="secondary" size="sm">Work Lots</Button>
              <Button href="/dashboard/stocker/treatments" variant="secondary" size="sm">Treat Cattle</Button>
              <Button href="/dashboard/stocker/feed" variant="secondary" size="sm">Feed Entry</Button>
              <Button href="/dashboard/stocker/reports" variant="secondary" size="sm">Review Billing</Button>
            </div>
          </Card>
          <Card style={{ ...cardStyle, padding: 18 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)" }}>Attention list</div>
            {attentionItems.length === 0 ? (
              <div style={{ ...metaTextStyle, marginTop: 10, lineHeight: 1.7 }}>
                No urgent system warnings right now. Use the drill-down below if you need owner, pen, or activity detail.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {attentionItems.map((item) => (
                  <div key={item} style={{ color: "var(--muted)", lineHeight: 1.7 }}>
                    {item}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </CardSection>

      <CardSection
        title="Inventory Drill-Down"
        rightSlot={
          canManage ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Button href="/dashboard/stocker/lots" variant="ghost" size="sm">Open Lots</Button>
              <Button href="/dashboard/stocker/pens" variant="ghost" size="sm">Pen Board</Button>
            </div>
          ) : undefined
        }
      >
        <p style={{ ...metaTextStyle, marginTop: 0, marginBottom: 16 }}>
          Keep the main screen simple. Open these summaries when you need owner or pen-level context.
        </p>
        <div style={{ display: "grid", gap: 16 }}>
          <details
            style={{
              border: "1px solid rgba(16, 42, 67, 0.08)",
              borderRadius: 16,
              padding: 14,
              background: "rgba(255, 255, 255, 0.7)",
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--ink)" }}>
              Inventory by owner
            </summary>
            <p style={{ ...metaTextStyle, marginTop: 12, marginBottom: 16 }}>
              {includeClosed ? "Includes closed lots." : "Open lots only."}
            </p>
            {ownerSnapshotRows.length === 0 ? (
              <div className="stocker-empty-state" style={emptyStateStyle}>
                No owner inventory matches the current filter.
              </div>
            ) : (
              <>
                <div className="stocker-mobile-cards">
                  {ownerSnapshotRows.map((row) => (
                    <Card key={row.id} style={cardStyle}>
                      <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>{row.name}</div>
                      <div style={{ ...metaTextStyle, marginTop: 8 }}>Head count: {row.headCount}</div>
                      <div style={{ ...metaTextStyle, marginTop: 6 }}>
                        Pens: {row.penNames.length === 0 ? "—" : row.penNames.join(", ")}
                      </div>
                      <div style={{ ...metaTextStyle, marginTop: 6 }}>
                        Oldest arrival: {row.oldestArrival ? row.oldestArrival.toLocaleDateString() : "—"}
                      </div>
                    </Card>
                  ))}
                </div>
                <Card className="stocker-desktop-table" style={tableContainerStyle}>
                  <Table>
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={{ padding: "8px 0" }}>Owner</th>
                        <th style={{ padding: "8px 0" }} data-align="right">Head Count</th>
                        <th style={{ padding: "8px 0" }}>Pens Involved</th>
                        <th style={{ padding: "8px 0" }}>Oldest Arrival</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownerSnapshotRows.map((row) => (
                        <tr key={row.id}>
                          <td style={{ padding: "10px 0" }}>{row.name}</td>
                          <td style={{ padding: "10px 0" }} data-align="right">{row.headCount}</td>
                          <td style={{ padding: "10px 0" }}>
                            {row.penNames.length === 0 ? "—" : `${row.penNames.length} (${row.penNames.join(", ")})`}
                          </td>
                          <td style={{ padding: "10px 0" }}>
                            {row.oldestArrival ? row.oldestArrival.toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </>
            )}
          </details>

          <details
            style={{
              border: "1px solid rgba(16, 42, 67, 0.08)",
              borderRadius: 16,
              padding: 14,
              background: "rgba(255, 255, 255, 0.7)",
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--ink)" }}>
              Inventory by pen
            </summary>
            <p style={{ ...metaTextStyle, marginTop: 12, marginBottom: 16 }}>
              Pen totals with owner breakdown ranked by head count.
            </p>
            {penSnapshotRows.length === 0 ? (
              <div className="stocker-empty-state" style={emptyStateStyle}>
                No pen inventory matches the current filter.
              </div>
            ) : (
              <>
                <div className="stocker-mobile-cards">
                  {penSnapshotRows.map((row) => (
                    <Card key={row.id} style={cardStyle}>
                      <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>{row.name}</div>
                      <div style={{ ...metaTextStyle, marginTop: 8 }}>Head count: {row.headCount}</div>
                      <div style={{ ...metaTextStyle, marginTop: 6 }}>
                        Owners:{" "}
                        {row.ownerBreakdown
                          .slice(0, 3)
                          .map((entry) => `${entry.ownerName} (${entry.headCount})`)
                          .join(", ") || "—"}
                      </div>
                    </Card>
                  ))}
                </div>
                <Card className="stocker-desktop-table" style={tableContainerStyle}>
                  <Table>
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={{ padding: "8px 0" }}>Pen</th>
                        <th style={{ padding: "8px 0" }} data-align="right">Head Count</th>
                        <th style={{ padding: "8px 0" }}>Owner Breakdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {penSnapshotRows.map((row) => (
                        <tr key={row.id}>
                          <td style={{ padding: "10px 0" }}>{row.name}</td>
                          <td style={{ padding: "10px 0" }} data-align="right">{row.headCount}</td>
                          <td style={{ padding: "10px 0" }}>
                            {row.ownerBreakdown
                              .slice(0, 3)
                              .map((entry) => `${entry.ownerName} (${entry.headCount})`)
                              .join(", ")}
                            {row.ownerBreakdown.length > 3 ? ` +${row.ownerBreakdown.length - 3} more` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </>
            )}
          </details>
        </div>
      </CardSection>

      <CardSection
        id="recent-activity"
        title="Recent Activity"
        rightSlot={
          <div style={metaTextStyle}>
            Timeline detail stays available here without crowding the main view.
          </div>
        }
      >
        {recentActivities.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No activity logged yet.
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
              View {recentActivities.length} recent events
            </summary>
            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {recentActivities.map((activity) => (
                <article
                  key={activity.id}
                  className="stocker-card"
                  style={{
                    ...cardStyle,
                    padding: 14,
                    background: "var(--card)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      alignItems: "baseline",
                    }}
                  >
                    <strong style={{ color: "var(--stocker-navy)", lineHeight: 1.5 }}>
                      {formatStockerActivityMessage(activity)}
                    </strong>
                    <span style={{ ...metaTextStyle, whiteSpace: "nowrap" }}>{activity.createdAt.toLocaleString()}</span>
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 8 }}>
                    {activity.createdBy?.name || activity.createdBy?.email || "System"}
                  </div>
                </article>
              ))}
            </div>
          </details>
        )}
      </CardSection>

      <CardSection
        title="Monthly Owner Snapshot"
        rightSlot={
          canManage ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Button href="/dashboard/stocker/reports" variant="ghost" size="sm">
                Billing Review
              </Button>
              <Button href="/dashboard/stocker/invoices" variant="ghost" size="sm">
                Manage Invoices
              </Button>
            </div>
          ) : undefined
        }
      >
        {ownerRows.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No Stocker data yet.
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
              View owner-level head-days and invoice totals for {label}
            </summary>
            <div style={{ ...metaTextStyle, marginTop: 10 }}>
              Active invoice totals below exclude voided invoices and follow the same month-matching logic used on the billing review page.
            </div>
            <div className="stocker-mobile-cards" style={{ marginTop: 14 }}>
              {ownerRows.map((row) => (
                <article key={row.id} className="stocker-card" style={cardStyle}>
                  <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>{row.name}</div>
                  <div style={{ ...metaTextStyle, marginTop: 8 }}>Inventory: {row.inventory}</div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>Head-days: {row.headDays}</div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>Invoices: ${row.invoiceTotal.toFixed(2)}</div>
                </article>
              ))}
            </div>
            <div className="stocker-desktop-table" style={{ ...tableContainerStyle, marginTop: 14 }}>
              <Table>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "8px 0" }}>Owner</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Inventory</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Head-Days</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {ownerRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: "10px 0" }}>{row.name}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">{row.inventory}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">{row.headDays}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">${row.invoiceTotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </details>
        )}
      </CardSection>
    </main>
  )
}
