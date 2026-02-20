import { redirect, notFound } from "next/navigation"
import { currentUser } from "@clerk/nextjs/server"
import { ensureCore } from "@/lib/ensure-core"
import { prisma } from "@/lib/prisma"

export default async function LogWeightPage({ params }: { params: { id: string } }) {
  const user = await currentUser()
  if (!user) return null

  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })

  const animal = await prisma.animal.findFirst({
    where: { id: params.id, organizationId: core.activeOrganizationId },
  })

  if (!animal) return notFound()

  async function logWeight(formData: FormData) {
    "use server"

    const weightRaw = (formData.get("weight") as string | null)?.trim()
    const notes = (formData.get("notes") as string | null)?.trim() || null

    const value = weightRaw ? Number(weightRaw) : NaN
    if (!Number.isFinite(value)) {
      // simple fallback — you can add real validation UI later
      throw new Error("Weight must be a number")
    }

    await prisma.event.create({
      data: {
        type: "WEIGHT",
        value,
        notes,
        animalId: animal.id,
        organizationId: core.activeOrganizationId,
        createdById: core.user.id,
      },
    })

    redirect(`/dashboard/animals/${animal.id}`)
  }

  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>Log Weight</h1>
      <p style={{ marginTop: 6 }}>
        {animal.tagNumber ? `#${animal.tagNumber}` : "Animal"} {animal.name ? `— ${animal.name}` : ""}
      </p>

      <form action={logWeight} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <label>
          Weight
          <input name="weight" placeholder="e.g. 642.5" style={{ display: "block", width: "100%", padding: 8 }} />
        </label>

        <label>
          Notes (optional)
          <input name="notes" placeholder="Morning weigh-in" style={{ display: "block", width: "100%", padding: 8 }} />
        </label>

        <button type="submit" style={{ padding: 10 }}>Save</button>
      </form>
    </main>
  )
}