import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireStockerAccess } from "@/lib/stocker"
import { buttonStyle, cardStyle, inputStyle, pageStyle, secondaryButtonStyle } from "@/lib/stocker-ui"
import { ModuleKey } from "@prisma/client"

export default async function OwnersPage() {
  const core = await requireStockerAccess()
  const orgId = core.activeOrganizationId

  const owners = await prisma.owner.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          lots: true,
          invoices: true,
        },
      },
    },
  })

  async function createOwner(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    const name = formData.get("name")?.toString().trim()
    if (!name) return

    await prisma.owner.create({
      data: {
        organizationId: orgId,
        name,
      },
    })

    revalidatePath("/dashboard/stocker/owners")
    revalidatePath("/dashboard/stocker")
  }

  async function updateOwner(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    const ownerId = formData.get("ownerId")?.toString()
    const name = formData.get("name")?.toString().trim()
    if (!ownerId || !name) return

    await prisma.owner.updateMany({
      where: { id: ownerId, organizationId: orgId },
      data: { name },
    })

    revalidatePath("/dashboard/stocker/owners")
    revalidatePath("/dashboard/stocker")
  }

  async function deleteOwner(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    const ownerId = formData.get("ownerId")?.toString()
    if (!ownerId) return

    const owner = await prisma.owner.findFirst({
      where: { id: ownerId, organizationId: orgId },
      select: {
        _count: {
          select: {
            lots: true,
            invoices: true,
          },
        },
      },
    })

    if (!owner || owner._count.lots > 0 || owner._count.invoices > 0) return

    await prisma.owner.deleteMany({
      where: { id: ownerId, organizationId: orgId },
    })

    revalidatePath("/dashboard/stocker/owners")
    revalidatePath("/dashboard/stocker")
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ marginTop: 0 }}>Owners</h1>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Add Owner</h2>
        <form action={createOwner} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input name="name" placeholder="Owner name" style={{ ...inputStyle, flex: "1 1 240px" }} />
          <button type="submit" style={buttonStyle}>
            Save Owner
          </button>
        </form>
      </section>

      <section style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {owners.length === 0 ? (
          <p>No owners yet.</p>
        ) : (
          owners.map((owner) => (
            <article key={owner.id} style={cardStyle}>
              <form action={updateOwner} style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="ownerId" value={owner.id} />
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Lots: {owner._count.lots}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Invoices: {owner._count.invoices}</div>
                </div>
                <input name="name" defaultValue={owner.name} style={inputStyle} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" style={buttonStyle}>
                    Update
                  </button>
                </div>
              </form>

              <form action={deleteOwner} style={{ marginTop: 10 }}>
                <input type="hidden" name="ownerId" value={owner.id} />
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
