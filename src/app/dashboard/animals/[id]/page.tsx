import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { currentUser } from "@clerk/nextjs/server"
import { ModuleKey } from "@prisma/client"
import { ensureCore } from "@/lib/ensure-core"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { prisma } from "@/lib/prisma"

export default async function AnimalDetailPage({ params }: { params: { id: string } }) {
  const user = await currentUser()
  if (!user) redirect("/sign-in")

  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })
  await requireModuleForOrganization(core.activeOrganizationId, ModuleKey.STOCKER)

  const animal = await prisma.animal.findFirst({
    where: { id: params.id, organizationId: core.activeOrganizationId },
    select: {
      id: true,
      tagNumber: true,
      name: true,
      sexClass: true,
      createdAt: true,
    },
  })

  if (!animal) notFound()

  // Capture primitives for server actions (TS closure-safe)
  const animalId = animal.id
  const orgId = core.activeOrganizationId

  const events = await prisma.event.findMany({
    where: { animalId, organizationId: orgId },
    orderBy: { eventDate: "desc" },
    take: 100,
  })

  const weights = events
    .filter((e) => e.type === "WEIGHT" && e.value !== null && e.value !== undefined)
    .map((e) => ({
      id: e.id,
      eventDate: e.eventDate,
      notes: e.notes,
      value: Number(e.value),
      type: e.type,
      organizationId: e.organizationId,
      animalId: e.animalId,
    }))
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())

  const latestWeight = weights[0]?.value ?? null
  const prevWeight = weights[1]?.value ?? null
  const delta = latestWeight !== null && prevWeight !== null ? latestWeight - prevWeight : null

  async function deleteEvent(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const eventId = String(formData.get("eventId") || "")
    if (!eventId) return

    await prisma.event.deleteMany({
      where: { id: eventId, organizationId: orgId },
    })

    redirect(`/dashboard/animals/${animalId}`)
  }

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>
            {animal.tagNumber ? `#${animal.tagNumber}` : "Animal"}
            {animal.name ? ` — ${animal.name}` : ""}
          </h1>
          <p style={{ marginTop: 6 }}>{animal.sexClass ? `Sex: ${animal.sexClass}` : "Sex: —"}</p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/dashboard/animals">← Back</Link>
          <Link href={`/dashboard/animals/${animalId}/weight`}>+ Log Weight</Link>
        </div>
      </header>

      {/* Weights */}
      <section style={{ marginTop: 18 }}>
        <h2 style={{ marginBottom: 8 }}>Weights</h2>

        <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
          <div>
            <strong>Latest:</strong> {latestWeight === null ? "—" : `${latestWeight.toFixed(1)} lb`}
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>Change:</strong>{" "}
            {delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} lb`}
          </div>
        </div>

        {weights.length === 0 ? (
          <p style={{ marginTop: 10 }}>No weights logged yet.</p>
        ) : (
          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            {weights.slice(0, 20).map((w) => (
              <li key={w.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <strong>{w.value.toFixed(1)} lb</strong>
                    {w.notes ? ` — ${w.notes}` : ""}
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {new Date(w.eventDate).toLocaleString()}
                    </div>
                  </div>

                  <form action={deleteEvent}>
                    <input type="hidden" name="eventId" value={w.id} />
                    <button type="submit" style={{ fontSize: 12, padding: "6px 10px" }}>
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent events (all types) */}
      <section style={{ marginTop: 22 }}>
        <h2 style={{ marginBottom: 8 }}>Recent Events</h2>

        {events.length === 0 ? (
          <p style={{ marginTop: 8 }}>No events yet.</p>
        ) : (
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {events.slice(0, 20).map((e) => (
              <li key={e.id} style={{ marginBottom: 8 }}>
                <strong>{e.type}</strong>{" "}
                {e.value !== null && e.value !== undefined ? `— ${e.value}` : ""}
                {e.notes ? ` — ${e.notes}` : ""}
                <div style={{ fontSize: 12, opacity: 0.75 }}>{new Date(e.eventDate).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
