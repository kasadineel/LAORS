import { redirect, notFound } from "next/navigation"
import { currentUser } from "@clerk/nextjs/server"
import { ModuleKey } from "@prisma/client"
import { ensureCore } from "@/lib/ensure-core"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { prisma } from "@/lib/prisma"

export default async function LogWeightPage({ params }: { params: { id: string } }) {
  const user = await currentUser()
  if (!user) return null

  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })
  await requireModuleForOrganization(core.activeOrganizationId, ModuleKey.STOCKER)

  const animal = await prisma.animal.findFirst({
    where: { id: params.id, organizationId: core.activeOrganizationId },
    select: { id: true, tagNumber: true, name: true },
  })

  if (!animal) notFound()

  // Capture non-null primitives so TS is happy inside the server action closure
  const animalId = animal.id
  const animalTagNumber = animal.tagNumber
  const animalName = animal.name
  const orgId = core.activeOrganizationId
  const createdById = core.user.id

  async function logWeight(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const weightRaw = (formData.get("weight") as string | null)?.trim()
    const notes = (formData.get("notes") as string | null)?.trim() || null

    const value = weightRaw ? Number(weightRaw) : NaN
    if (!Number.isFinite(value)) {
      throw new Error("Weight must be a number")
    }

    await prisma.event.create({
      data: {
        type: "WEIGHT",
        value,
        notes,
        animalId,
        organizationId: orgId,
        createdById,
      },
    })

    redirect(`/dashboard/animals/${animalId}`)
  }

  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>Log Weight</h1>
      <p style={{ marginTop: 6 }}>
        {animalTagNumber ? `#${animalTagNumber}` : "Animal"} {animalName ? `— ${animalName}` : ""}
      </p>

      <form action={logWeight} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <label>
          Weight
          <input
            name="weight"
            placeholder="e.g. 642.5"
            style={{ display: "block", width: "100%", padding: 8 }}
          />
        </label>

        <label>
          Notes (optional)
          <input
            name="notes"
            placeholder="Morning weigh-in"
            style={{ display: "block", width: "100%", padding: 8 }}
          />
        </label>

        <button type="submit" style={{ padding: 10 }}>
          Save
        </button>
      </form>
    </main>
  )
}
