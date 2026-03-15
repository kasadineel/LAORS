import { ActionBar } from "@/components/stocker/ActionBar"
import { Card } from "@/components/stocker/ui/Card"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Table } from "@/components/stocker/ui/Table"
import { formatMoney } from "@/lib/treatment-pricing"
import { formatFeedLbs, formatFeedTons, getMonthlyFeedSummary } from "@/lib/stocker-feed"
import { getRoleDisplayName, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { getMonthWindow, requireStockerAccess } from "@/lib/stocker"
import {
  cardStyle,
  emptyStateStyle,
  inputStyle,
  metricCardStyle,
  metricLabelStyle,
  metricValueStyle,
  pageStyle,
  stackStyle,
  tableContainerStyle,
} from "@/lib/stocker-ui"

type FeedMonthlyPageProps = {
  searchParams?:
    | Promise<{ month?: string | string[] }>
    | { month?: string | string[] }
}

export default async function FeedMonthlyPage({ searchParams }: FeedMonthlyPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const monthParam = Array.isArray(resolvedSearchParams.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams.month
  const { monthValue, monthStart, monthEnd, label } = getMonthWindow(monthParam)
  const summary = await getMonthlyFeedSummary({
    organizationId: core.activeOrganizationId,
    monthStart,
    monthEnd,
  })

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Monthly Feed Summary"
        subtitle="Review allocated feed by owner and lot for the selected billing month before it rolls into owner charges and draft invoices."
        badge="Feed"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
        monthLabel={label}
      />
      <ActionBar
        primaryAction={{ href: "/dashboard/stocker/feed", label: "Daily Feed Entry" }}
        secondaryActions={[
          { href: "/dashboard/stocker/reports", label: "Billing Review" },
        ]}
      />

      <CardSection title="Feed Month Filter">
        <form action="/dashboard/stocker/feed/monthly" method="get" style={{ ...stackStyle, maxWidth: 340 }}>
          <Input
            label="Month"
            type="month"
            name="month"
            defaultValue={monthValue}
            style={inputStyle}
          />
          <div>
            <Button type="submit" variant="primary">
              Review Feed
            </Button>
          </div>
        </form>
      </CardSection>

      <CardSection title={`Feed Totals for ${label}`}>
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <article className="stocker-card" style={metricCardStyle}>
            <div style={metricLabelStyle}>Allocated Feed</div>
            <div style={metricValueStyle}>{formatFeedLbs(summary.totals.totalLbs)}</div>
            <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              Total pounds allocated to owners and lots for {label}.
            </p>
          </article>
          <article className="stocker-card" style={metricCardStyle}>
            <div style={metricLabelStyle}>Allocated Tons</div>
            <div style={metricValueStyle}>{summary.totals.totalTons.toFixed(2)}</div>
            <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              Converted from stored pound entries using 2,000 lbs per ton.
            </p>
          </article>
          <article className="stocker-card" style={metricCardStyle}>
            <div style={metricLabelStyle}>Allocated Cost</div>
            <div style={metricValueStyle}>{formatMoney(summary.totals.totalCost)}</div>
            <p style={{ marginBottom: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              Feed cost is calculated from ration cost snapshots captured when the feed was entered.
            </p>
          </article>
        </div>
      </CardSection>

      <CardSection title="Owner and Lot Allocation">
        {summary.rows.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No allocated feed for this month.</strong>
            Record daily feed entries or add shared-pen allocation rules before reviewing monthly feed charges.
          </div>
        ) : (
          <>
            <div className="stocker-mobile-cards">
              {summary.rows.map((row) => (
                <Card key={`${row.ownerId}:${row.lotId}`} style={cardStyle}>
                  <div style={{ fontWeight: 700, color: "var(--ink)" }}>{row.ownerName}</div>
                  <div style={{ color: "var(--muted)", marginTop: 6 }}>{row.lotLabel}</div>
                  <div style={{ color: "var(--muted)", marginTop: 10 }}>{formatFeedLbs(row.totalLbs)}</div>
                  <div style={{ color: "var(--muted)", marginTop: 6 }}>{formatFeedTons(row.totalTons)}</div>
                  <div style={{ fontWeight: 700, color: "var(--ink)", marginTop: 10 }}>
                    {formatMoney(row.totalCost)}
                  </div>
                </Card>
              ))}
            </div>
            <Card className="stocker-desktop-table" style={tableContainerStyle}>
              <Table>
                <thead>
                  <tr>
                    <th style={{ padding: "8px 0" }}>Owner</th>
                    <th style={{ padding: "8px 0" }}>Lot</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Total Lbs Fed</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Total Tons</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Feed Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((row) => (
                    <tr key={`${row.ownerId}:${row.lotId}`}>
                      <td style={{ padding: "10px 0", fontWeight: 700 }}>{row.ownerName}</td>
                      <td style={{ padding: "10px 0" }}>{row.lotLabel}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">{formatFeedLbs(row.totalLbs)}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">{formatFeedTons(row.totalTons)}</td>
                      <td style={{ padding: "10px 0", fontWeight: 700 }} data-align="right">{formatMoney(row.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </>
        )}
      </CardSection>

      {summary.unallocatedEntries.length > 0 ? (
        <CardSection title="Unallocated Feed Entries">
          <div style={stackStyle}>
            {summary.unallocatedEntries.map((entry) => (
              <article key={entry.entryId} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>Feed entry requires review</div>
                <p style={{ marginBottom: 0, marginTop: 8, color: "var(--muted)", lineHeight: 1.6 }}>
                  {entry.reason}
                </p>
              </article>
            ))}
          </div>
        </CardSection>
      ) : null}
    </main>
  )
}
