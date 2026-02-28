import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { ensureUserOrganization } from "@/lib/onboard-user"

export default async function NewAnimalPage() {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const orgId = await ensureUserOrganization(userId)
  if (!orgId) redirect("/sign-in")

  async function createAnimal(formData: FormData) {
    "use server"

    const tagNumber = (formData.get("tagNumber")?.toString() || "").trim() || null
    const name = (formData.get("name")?.toString() || "").trim() || null
    const sexClass = (formData.get("sexClass")?.toString() || "").trim() || null

    await prisma.animal.create({
      data: {
        tagNumber,
        name,
        sexClass,
        organizationId: orgId,
      },
    })

    redirect("/dashboard/animals")
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Add Animal</h1>

      <form action={createAnimal} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 400 }}>
        <input name="tagNumber" placeholder="Tag #" style={{ padding: 8 }} />
        <input name="name" placeholder="Name" style={{ padding: 8 }} />
        <input name="sexClass" placeholder="Sex Class (HEIFER/STEER…)" style={{ padding: 8 }} />
        <button type="submit" style={{ padding: "8px 12px" }}>Save Animal</button>
      </form>
    </main>
  )
}