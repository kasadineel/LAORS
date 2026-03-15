import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { ModuleKey } from "@prisma/client"
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
} from "@/lib/stocker-ui"

export default async function PensPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId

  const pens = await prisma.pen.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      capacity: true,
      _count: {
        select: {
          lots: true,
          outgoingMoves: true,
          incomingMoves: true,
        },
      },
    },
  })

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
        subtitle="Manage pen names and capacities for the current organization."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
      />
      <ActionBar primaryAction={{ href: "#new-pen", label: "+ New Pen" }} />

      <CardSection id="new-pen" title="New Pen">
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
      </CardSection>

      <CardSection title="Pen Directory">
        {pens.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No pens yet.</strong>
            Create your first pen to start organizing cattle flow across the yard.
          </div>
        ) : (
          <div style={stackStyle}>
            {pens.map((pen) => (
              <article key={pen.id} className="stocker-card" style={cardStyle}>
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
            ))}
          </div>
        )}
      </CardSection>
    </main>
  )
}
