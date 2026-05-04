import { notFound, redirect } from "next/navigation"
import { ModuleKey } from "@prisma/client"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { prisma } from "@/lib/prisma"
import { getAnimalEventTypeLabel, normalizeAnimalEventType } from "@/lib/animal-events"
import { requireStockerAccess, parseDateInput, parseNumberInput, toDateInputValue } from "@/lib/stocker"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { getRoleDisplayName } from "@/lib/permissions"
import { cardStyle, emptyStateStyle, metaTextStyle, pageStyle, stackStyle } from "@/lib/stocker-ui"

export default async function AnimalDetailPage({ params }: { params: { id: string } }) {
  const core = await requireStockerAccess()
  await requireModuleForOrganization(core.activeOrganizationId, ModuleKey.STOCKER)

  const animal = await prisma.animal.findFirst({
    where: { id: params.id, organizationId: core.activeOrganizationId },
    select: {
      id: true,
      tagNumber: true,
      name: true,
      sexClass: true,
      birthDate: true,
      notes: true,
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
    .filter((e) => normalizeAnimalEventType(e.type) === "WEIGHT" && e.value !== null && e.value !== undefined)
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

  async function createEvent(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const type = normalizeAnimalEventType(formData.get("type")?.toString())
    const value = parseNumberInput(formData.get("value"))
    const notes = (formData.get("notes")?.toString() || "").trim() || null
    const eventDate = parseDateInput(formData.get("eventDate"), new Date())

    if (!eventDate) return

    await prisma.event.create({
      data: {
        type,
        value,
        notes,
        eventDate,
        animalId,
        organizationId: orgId,
        createdById: core.user.id,
      },
    })

    redirect(`/dashboard/animals/${animalId}`)
  }

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
    <main style={pageStyle}>
      <PageHeader
        title={`${animal.tagNumber ? `#${animal.tagNumber}` : "Animal"}${animal.name ? ` · ${animal.name}` : ""}`}
        subtitle="Review an individual animal’s weight history and field events in one record."
        badge="Core Records"
      />
      <StatusRow organizationName={core.organization.name} roleLabel={getRoleDisplayName(core.role)} />
      <ActionBar
        primaryAction={{ href: `/dashboard/animals/${animalId}/weight`, label: "+ Log Weight" }}
        secondaryActions={[{ href: "/dashboard/animals", label: "Back to Animals" }]}
      />

      <CardSection title="Animal Snapshot">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {[
            { label: "Tag", value: animal.tagNumber ?? "Not recorded" },
            { label: "Name", value: animal.name ?? "Unnamed" },
            { label: "Sex Class", value: animal.sexClass ?? "Not recorded" },
            { label: "Birth Date", value: animal.birthDate ? animal.birthDate.toLocaleDateString() : "Not recorded" },
            { label: "Latest Weight", value: latestWeight === null ? "—" : `${latestWeight.toFixed(1)} lb` },
            { label: "Change", value: delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} lb` },
          ].map((item) => (
            <article key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, fontWeight: 700, fontSize: 18, color: "var(--ink)" }}>{item.value}</div>
            </article>
          ))}
        </div>
        {animal.notes ? (
          <div className="stocker-card" style={{ ...cardStyle, padding: 16, marginTop: 16 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>Animal Notes</div>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>{animal.notes}</p>
          </div>
        ) : null}
      </CardSection>

      <CardSection title="Add Event">
        <form action={createEvent} style={{ ...stackStyle, maxWidth: 760 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Select label="Event Type" name="type" defaultValue="NOTE" style={{}}>
              <option value="NOTE">Note</option>
              <option value="WEIGHT">Weight</option>
              <option value="HEALTH">Health</option>
              <option value="BREEDING">Breeding</option>
            </Select>
            <Input label="Value" name="value" inputMode="decimal" placeholder="Optional numeric value" style={{}} />
            <Input label="Event Date" name="eventDate" type="date" defaultValue={toDateInputValue(new Date())} style={{}} />
          </div>
          <Textarea label="Notes" name="notes" rows={3} placeholder="Morning check, treatment note, or other context" style={{}} />
          <div>
            <Button type="submit" variant="primary">
              Save Event
            </Button>
          </div>
        </form>
      </CardSection>

      <CardSection title="Weight History">
        {weights.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>No weights logged yet.</div>
        ) : (
          <div style={stackStyle}>
            {weights.slice(0, 20).map((weight) => (
              <article key={weight.id} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--ink)" }}>{weight.value.toFixed(1)} lb</div>
                    <div style={metaTextStyle}>{new Date(weight.eventDate).toLocaleString()}</div>
                    {weight.notes ? <div style={{ ...metaTextStyle, marginTop: 6 }}>{weight.notes}</div> : null}
                  </div>
                  <form action={deleteEvent}>
                    <input type="hidden" name="eventId" value={weight.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </CardSection>

      <CardSection title="Recent Events">
        {events.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>No events logged for this animal yet.</div>
        ) : (
          <div style={stackStyle}>
            {events.slice(0, 20).map((event) => (
              <article key={event.id} className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                  {getAnimalEventTypeLabel(event.type)}{event.value !== null && event.value !== undefined ? ` · ${event.value}` : ""}
                </div>
                <div style={metaTextStyle}>{new Date(event.eventDate).toLocaleString()}</div>
                {event.notes ? <p style={{ marginBottom: 0, marginTop: 10, color: "var(--muted)" }}>{event.notes}</p> : null}
              </article>
            ))}
          </div>
        )}
      </CardSection>
    </main>
  )
}
