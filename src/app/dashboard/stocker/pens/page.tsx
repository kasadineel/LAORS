import { revalidatePath } from "next/cache"
import { ModuleKey } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireStockerAccess } from "@/lib/stocker"
import { buttonStyle, cardStyle, inputStyle, pageStyle, secondaryButtonStyle } from "@/lib/stocker-ui"

export default async function PensPage() {
  const core = await requireStockerAccess()
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
      <h1 style={{ marginTop: 0 }}>Pens</h1>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Add Pen</h2>
        <form action={createPen} style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr auto" }}>
          <input name="name" placeholder="Pen name" style={inputStyle} />
          <input name="capacity" placeholder="Capacity" inputMode="numeric" style={inputStyle} />
          <button type="submit" style={buttonStyle}>
            Save Pen
          </button>
        </form>
      </section>

      <section style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {pens.length === 0 ? (
          <p>No pens yet.</p>
        ) : (
          pens.map((pen) => (
            <article key={pen.id} style={cardStyle}>
              <form action={updatePen} style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="penId" value={pen.id} />
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Lots: {pen._count.lots} | Moves: {pen._count.outgoingMoves + pen._count.incomingMoves}
                </div>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
                  <input name="name" defaultValue={pen.name} style={inputStyle} />
                  <input
                    name="capacity"
                    defaultValue={pen.capacity ?? ""}
                    inputMode="numeric"
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" style={buttonStyle}>
                    Update
                  </button>
                </div>
              </form>

              <form action={deletePen} style={{ marginTop: 10 }}>
                <input type="hidden" name="penId" value={pen.id} />
                <button type="submit" style={secondaryButtonStyle}>
                  Delete
                </button>
              </form>
            </article>
          ))
        )}
      </section>
    </main>
  )
}
