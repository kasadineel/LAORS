import { auth } from "@clerk/nextjs/server"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { ensureUserOrganization } from "@/lib/onboard-user"

export default async function AnimalDetailPage(
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params

  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const orgId = await ensureUserOrganization(userId)
  if (!orgId) redirect("/sign-in")

  const animal = await prisma.animal.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      tagNumber: true,
      name: true,
      sexClass: true,
      birthDate: true,
      notes: true,
      events: {
        orderBy: { eventDate: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          value: true,
          notes: true,
          eventDate: true,
        },
      },
    },
  })

  if (!animal) notFound()

  return (
    <main style={{ padding: 24 }}>
      <h1>
        {animal.tagNumber ?? "No tag"} — {animal.name ?? "Unnamed"}
      </h1>

      <p><strong>Sex Class:</strong> {animal.sexClass ?? "—"}</p>

      <hr style={{ margin: "16px 0" }} />

      <h2>Recent Events</h2>

      {animal.events.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ul>
          {animal.events.map((e) => (
            <li key={e.id}>
              <strong>{e.type}</strong>
              {typeof e.value === "number" ? ` — ${e.value}` : ""}
              {e.notes ? ` — ${e.notes}` : ""} —{" "}
              {new Date(e.eventDate).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}