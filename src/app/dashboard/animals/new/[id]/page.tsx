import Link from "next/link"
import { notFound } from "next/navigation"
import { currentUser } from "@clerk/nextjs/server"
import { ensureCore } from "@/lib/ensure-core"
import { prisma } from "@/lib/prisma"

export default async function AnimalDetailPage({ params }: { params: { id: string } }) {
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

  const events = await prisma.event.findMany({
    where: { animalId: animal.id, organizationId: core.activeOrganizationId },
    orderBy: { eventDate: "desc" },
    take: 20,
  })

  return (
    <main style={{ padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>
            {animal.tagNumber ? `#${animal.tagNumber}` : "Animal"} {animal.name ? `— ${animal.name}` : ""}
          </h1>
          <p style={{ marginTop: 6 }}>
            {animal.sexClass ? `Sex: ${animal.sexClass}` : "Sex: —"}
          </p>
        </div>

        <Link href={`/dashboard/animals/${animal.id}/weight`}>+ Log Weight</Link>
      </header>

      <section style={{ marginTop: 18 }}>
        <h2>Recent Events</h2>
        {events.length === 0 ? (
          <p style={{ marginTop: 8 }}>No events yet.</p>
        ) : (
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {events.map((e) => (
              <li key={e.id} style={{ marginBottom: 8 }}>
                <strong>{e.type}</strong>{" "}
                {e.value !== null && e.value !== undefined ? `— ${e.value}` : ""}
                {e.notes ? ` — ${e.notes}` : ""}
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {new Date(e.eventDate).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}