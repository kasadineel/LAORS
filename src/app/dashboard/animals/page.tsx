import { ModuleKey } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireStockerAccess } from "@/lib/stocker"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { Button } from "@/components/stocker/ui/Button"
import { Table } from "@/components/stocker/ui/Table"
import { getRoleDisplayName } from "@/lib/permissions"
import { cardStyle, emptyStateStyle, metaTextStyle, pageStyle, stackStyle, tableContainerStyle } from "@/lib/stocker-ui"

export default async function AnimalsPage() {
  const core = await requireStockerAccess()
  const orgId = core.activeOrganizationId
  await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

  const animals = await prisma.animal.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tagNumber: true,
      name: true,
      sexClass: true,
      birthDate: true,
      createdAt: true,
      _count: { select: { events: true } },
    },
  })

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Animals"
        subtitle="Track individual cattle records, weight events, and field notes without leaving the ranch recordkeeping flow."
        badge="Core Records"
      />
      <StatusRow organizationName={core.organization.name} roleLabel={getRoleDisplayName(core.role)} />
      <ActionBar primaryAction={{ href: "/dashboard/animals/new", label: "+ Add Animal" }} />

      <CardSection title="Animal Directory">
        {animals.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No animals have been recorded yet.
          </div>
        ) : (
          <>
            <div className="stocker-mobile-cards" style={stackStyle}>
              {animals.map((animal) => (
                <article key={animal.id} className="stocker-card" style={cardStyle}>
                  <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                    {animal.tagNumber ? `#${animal.tagNumber}` : "No tag"} {animal.name ? `· ${animal.name}` : ""}
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 8 }}>
                    {animal.sexClass ?? "No sex class"} · {animal.birthDate ? animal.birthDate.toLocaleDateString() : "Birth date not recorded"}
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>
                    {animal._count.events} event{animal._count.events === 1 ? "" : "s"} logged
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Button href={`/dashboard/animals/${encodeURIComponent(animal.id)}`} variant="secondary" size="sm">
                      View Record
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            <Table className="stocker-desktop-table" style={tableContainerStyle}>
              <thead>
                <tr>
                  <th style={{ padding: "8px 0" }}>Tag</th>
                  <th style={{ padding: "8px 0" }}>Name</th>
                  <th style={{ padding: "8px 0" }}>Sex Class</th>
                  <th style={{ padding: "8px 0" }}>Birth Date</th>
                  <th style={{ padding: "8px 0" }} data-align="right">Events</th>
                  <th style={{ padding: "8px 0" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {animals.map((animal) => (
                  <tr key={animal.id}>
                    <td style={{ padding: "10px 0", fontWeight: 700 }}>{animal.tagNumber ?? "—"}</td>
                    <td style={{ padding: "10px 0" }}>{animal.name ?? "Unnamed"}</td>
                    <td style={{ padding: "10px 0" }}>{animal.sexClass ?? "—"}</td>
                    <td style={{ padding: "10px 0" }}>{animal.birthDate ? animal.birthDate.toLocaleDateString() : "—"}</td>
                    <td style={{ padding: "10px 0" }} data-align="right">{animal._count.events}</td>
                    <td style={{ padding: "10px 0" }}>
                      <Button href={`/dashboard/animals/${encodeURIComponent(animal.id)}`} variant="secondary" size="sm">
                        View Record
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </CardSection>
    </main>
  )
}
