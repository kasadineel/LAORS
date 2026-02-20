import { redirect } from "next/navigation"
import { currentUser } from "@clerk/nextjs/server"
import { ensureCore } from "@/lib/ensure-core"
import { prisma } from "@/lib/prisma"

export default async function NewAnimalPage() {
  const user = await currentUser()
  if (!user) return null

  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })

  async function createAnimal(formData: FormData) {
    "use server"

    const tagNumber = (formData.get("tagNumber") as string | null)?.trim() || null
    const name = (formData.get("name") as string | null)?.trim() || null
    const sexClass = (formData.get("sexClass") as string | null)?.trim() || null

    await prisma.animal.create({
      data: {
        tagNumber,
        name,
        sexClass,
        organizationId: core.activeOrganizationId,
      },
    })

    redirect("/dashboard/animals")
  }

  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>Add Animal</h1>

      <form action={createAnimal} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <label>
          Tag Number
          <input name="tagNumber" placeholder="A001" style={{ display: "block", width: "100%", padding: 8 }} />
        </label>

        <label>
          Name (optional)
          <input name="name" placeholder="Red Queen" style={{ display: "block", width: "100%", padding: 8 }} />
        </label>

        <label>
          Sex Class (optional)
          <input name="sexClass" placeholder="HEIFER / STEER / BULL / COW" style={{ display: "block", width: "100%", padding: 8 }} />
        </label>

        <button type="submit" style={{ padding: 10 }}>Create</button>
      </form>
    </main>
  )
}