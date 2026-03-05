import { revalidatePath } from "next/cache"
import { ModuleKey } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import {
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  toDateInputValue,
} from "@/lib/stocker"
import { buttonStyle, cardStyle, gridStyle, inputStyle, pageStyle, secondaryButtonStyle } from "@/lib/stocker-ui"

export default async function TreatmentsPage() {
  const core = await requireStockerAccess()
  const orgId = core.activeOrganizationId

  const [lots, treatments] = await Promise.all([
    prisma.lot.findMany({
      where: { organizationId: orgId },
      orderBy: { arrivalDate: "desc" },
      select: {
        id: true,
        headCount: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
      },
    }),
    prisma.treatment.findMany({
      where: {
        lot: {
          organizationId: orgId,
        },
      },
      orderBy: { date: "desc" },
      select: {
        id: true,
        medicine: true,
        dosePerHead: true,
        date: true,
        notes: true,
        lot: {
          select: {
            id: true,
            owner: { select: { name: true } },
            pen: { select: { name: true } },
          },
        },
      },
    }),
  ])

  async function createTreatment(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const lotId = formData.get("lotId")?.toString()
    const medicine = formData.get("medicine")?.toString().trim()
    const dosePerHead = parseNumberInput(formData.get("dosePerHead"))
    const date = parseDateInput(formData.get("date"), new Date())
    const notes = formData.get("notes")?.toString().trim() || null

    if (!lotId || !medicine || dosePerHead === null || !date) return

    const lot = await prisma.lot.findFirst({
      where: { id: lotId, organizationId: orgId },
      select: { id: true },
    })

    if (!lot) return

    await prisma.treatment.create({
      data: {
        lotId,
        medicine,
        dosePerHead,
        date,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/treatments")
  }

  async function deleteTreatment(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const treatmentId = formData.get("treatmentId")?.toString()
    if (!treatmentId) return

    await prisma.treatment.deleteMany({
      where: {
        id: treatmentId,
        lot: {
          organizationId: orgId,
        },
      },
    })

    revalidatePath("/dashboard/stocker/treatments")
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ marginTop: 0 }}>Treatments</h1>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Log Treatment</h2>
        {lots.length === 0 ? (
          <p>Create a lot before logging treatments.</p>
        ) : (
          <form action={createTreatment} style={{ display: "grid", gap: 12 }}>
            <div style={gridStyle}>
              <select name="lotId" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Select lot
                </option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.owner.name} / {lot.pen.name} / {lot.headCount} head
                  </option>
                ))}
              </select>
              <input name="medicine" placeholder="Medicine" style={inputStyle} />
              <input name="dosePerHead" placeholder="Dose per head" inputMode="decimal" style={inputStyle} />
              <input name="date" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
            </div>
            <textarea name="notes" rows={3} placeholder="Notes" style={inputStyle} />
            <div>
              <button type="submit" style={buttonStyle}>
                Save Treatment
              </button>
            </div>
          </form>
        )}
      </section>

      <section style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {treatments.length === 0 ? (
          <p>No treatments logged yet.</p>
        ) : (
          treatments.map((treatment) => (
            <article key={treatment.id} style={cardStyle}>
              <div style={{ fontWeight: 600 }}>{treatment.medicine}</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>
                {treatment.lot.owner.name} / {treatment.lot.pen.name}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                Dose: {treatment.dosePerHead} | Date: {treatment.date.toLocaleDateString()}
              </div>
              {treatment.notes ? <p style={{ marginBottom: 0 }}>{treatment.notes}</p> : null}
              <form action={deleteTreatment} style={{ marginTop: 12 }}>
                <input type="hidden" name="treatmentId" value={treatment.id} />
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
