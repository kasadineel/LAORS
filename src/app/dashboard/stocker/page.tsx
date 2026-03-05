import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { calculateHeadDaysForLot, getMonthWindow, requireStockerAccess } from "@/lib/stocker"
import { cardStyle, pageStyle } from "@/lib/stocker-ui"

type StockerDashboardPageProps = {
  searchParams?: Promise<{ month?: string | string[] }> | { month?: string | string[] }
}

export default async function StockerDashboardPage({ searchParams }: StockerDashboardPageProps) {
  const core = await requireStockerAccess()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const monthParam = Array.isArray(resolvedSearchParams.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams.month
  const { monthStart, monthEnd, monthValue, label } = getMonthWindow(monthParam)
  const orgId = core.activeOrganizationId
  const today = new Date()

  const [owners, lotsForMonth, activeLots, invoices] = await Promise.all([
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
      },
    }),
    prisma.lot.findMany({
      where: {
        organizationId: orgId,
        arrivalDate: { lte: today },
        OR: [{ exitDate: null }, { exitDate: { gte: today } }],
      },
      select: {
        ownerId: true,
        headCount: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        date: { gte: monthStart, lt: monthEnd },
      },
      select: {
        ownerId: true,
        total: true,
      },
    }),
  ])

  const ownerRows = owners.map((owner) => {
    const inventory = activeLots
      .filter((lot) => lot.ownerId === owner.id)
      .reduce((sum, lot) => sum + lot.headCount, 0)

    const headDays = lotsForMonth
      .filter((lot) => lot.ownerId === owner.id)
      .reduce(
        (sum, lot) =>
          sum +
          calculateHeadDaysForLot(lot.arrivalDate, lot.exitDate, lot.headCount, monthStart, monthEnd),
        0,
      )

    const invoiceTotal = invoices
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

  return (
    <main style={pageStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Stocker Summary</h1>
          <p style={{ marginTop: 8 }}>Monthly inventory, head-days, and invoice totals for {label}.</p>
        </div>

        <form action="/dashboard/stocker" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="month" name="month" defaultValue={monthValue} />
          <button type="submit">View</button>
        </form>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          marginTop: 20,
        }}
      >
        <section style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Current Inventory</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{totals.inventory}</div>
        </section>
        <section style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Head-Days</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{totals.headDays}</div>
        </section>
        <section style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Invoice Total</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>${totals.invoiceTotal.toFixed(2)}</div>
        </section>
      </div>

      <section style={{ ...cardStyle, marginTop: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>By Owner</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/dashboard/stocker/owners">Manage Owners</Link>
            <Link href="/dashboard/stocker/lots">Manage Lots</Link>
            <Link href="/dashboard/stocker/invoices">Manage Invoices</Link>
          </div>
        </div>

        {ownerRows.length === 0 ? (
          <p>No Stocker data yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "8px 0" }}>Owner</th>
                  <th style={{ padding: "8px 0" }}>Inventory</th>
                  <th style={{ padding: "8px 0" }}>Head-Days</th>
                  <th style={{ padding: "8px 0" }}>Invoices</th>
                </tr>
              </thead>
              <tbody>
                {ownerRows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "10px 0" }}>{row.name}</td>
                    <td style={{ padding: "10px 0" }}>{row.inventory}</td>
                    <td style={{ padding: "10px 0" }}>{row.headDays}</td>
                    <td style={{ padding: "10px 0" }}>${row.invoiceTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
