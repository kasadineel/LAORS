import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { getRoleDisplayName, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { getMonthWindow, requireStockerAccess } from "@/lib/stocker"
import {
  cardStyle,
  emptyStateStyle,
  inputStyle,
  pageStyle,
  stackStyle,
} from "@/lib/stocker-ui"

type OwnerStatementPageProps = {
  searchParams?: Promise<{ month?: string | string[]; ownerId?: string | string[] }> | { month?: string | string[]; ownerId?: string | string[] }
}

export default async function OwnerStatementPage({ searchParams }: OwnerStatementPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const monthParam = Array.isArray(resolvedSearchParams.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams.month
  const ownerIdParam = Array.isArray(resolvedSearchParams.ownerId)
    ? resolvedSearchParams.ownerId[0]
    : resolvedSearchParams.ownerId
  const { monthValue, label } = getMonthWindow(monthParam)

  const owners = await prisma.owner.findMany({
    where: { organizationId: core.activeOrganizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
    },
  })

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Owner Statement Export"
        subtitle={`Export a monthly owner statement with lots, treatments, invoices, and invoice lines for ${label}.`}
        badge="Reports"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
        monthLabel={label}
      />
      <ActionBar
        primaryAction={{ href: "#owner-statement-export", label: "Download CSV" }}
        secondaryActions={[{ href: "/dashboard/stocker/reports", label: "Back to Reports" }]}
      />

      <CardSection id="owner-statement-export" title="Download CSV">
        {owners.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No owners yet.</strong>
            Create your first owner to export a monthly statement.
          </div>
        ) : (
          <form
            action="/dashboard/stocker/reports/owner-statement.csv"
            method="get"
            style={{ ...stackStyle, maxWidth: 560 }}
          >
            <Input label="Month" type="month" name="month" defaultValue={monthValue} style={inputStyle} />

            <Select label="Owner" name="ownerId" defaultValue={ownerIdParam ?? ""} required style={inputStyle}>
                <option value="" disabled>
                  Select owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>

            <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ color: "var(--stocker-navy)", fontWeight: 700 }}>Statement sections</div>
              <p style={{ marginBottom: 0, color: "var(--stocker-muted)", lineHeight: 1.6 }}>
                Header, summary, lots, treatments, invoices, and invoice lines for the selected month.
              </p>
            </div>

            <div>
              <Button type="submit" variant="primary">
                Download CSV
              </Button>
            </div>
          </form>
        )}
      </CardSection>
    </main>
  )
}
