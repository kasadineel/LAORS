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
import {
  buttonStyle,
  cardStyle,
  gridStyle,
  inputStyle,
  pageStyle,
  secondaryButtonStyle,
} from "@/lib/stocker-ui"

export default async function LotsPage() {
  const core = await requireStockerAccess()
  const orgId = core.activeOrganizationId

  const [owners, pens, lots] = await Promise.all([
    prisma.owner.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.pen.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lot.findMany({
      where: { organizationId: orgId },
      orderBy: [{ exitDate: "asc" }, { arrivalDate: "desc" }],
      select: {
        id: true,
        headCount: true,
        arrivalDate: true,
        exitDate: true,
        notes: true,
        ownerId: true,
        penId: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
        _count: {
          select: {
            treatments: true,
            moves: true,
          },
        },
      },
    }),
  ])

  async function createLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const ownerId = formData.get("ownerId")?.toString()
    const penId = formData.get("penId")?.toString()
    const headCount = parseNumberInput(formData.get("headCount"))
    const arrivalDate = parseDateInput(formData.get("arrivalDate"))
    const notes = formData.get("notes")?.toString().trim() || null

    if (!ownerId || !penId || !headCount || !arrivalDate) return
    if (!Number.isInteger(headCount) || headCount <= 0) return

    const [owner, pen] = await Promise.all([
      prisma.owner.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true } }),
      prisma.pen.findFirst({ where: { id: penId, organizationId: orgId }, select: { id: true } }),
    ])

    if (!owner || !pen) return

    await prisma.lot.create({
      data: {
        organizationId: orgId,
        ownerId,
        penId,
        headCount,
        arrivalDate,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function updateLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const lotId = formData.get("lotId")?.toString()
    const ownerId = formData.get("ownerId")?.toString()
    const penId = formData.get("penId")?.toString()
    const headCount = parseNumberInput(formData.get("headCount"))
    const arrivalDate = parseDateInput(formData.get("arrivalDate"))
    const exitDate = parseDateInput(formData.get("exitDate"))
    const notes = formData.get("notes")?.toString().trim() || null

    if (!lotId || !ownerId || !penId || !headCount || !arrivalDate) return
    if (!Number.isInteger(headCount) || headCount <= 0) return

    const [owner, pen] = await Promise.all([
      prisma.owner.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true } }),
      prisma.pen.findFirst({ where: { id: penId, organizationId: orgId }, select: { id: true } }),
    ])

    if (!owner || !pen) return

    await prisma.lot.updateMany({
      where: {
        id: lotId,
        organizationId: orgId,
      },
      data: {
        ownerId,
        penId,
        headCount,
        arrivalDate,
        exitDate,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function closeLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const lotId = formData.get("lotId")?.toString()
    const exitDate = parseDateInput(formData.get("exitDate"), new Date())
    if (!lotId || !exitDate) return

    await prisma.lot.updateMany({
      where: {
        id: lotId,
        organizationId: orgId,
      },
      data: { exitDate },
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function moveLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const lotId = formData.get("lotId")?.toString()
    const toPenId = formData.get("toPenId")?.toString()
    const moveDate = parseDateInput(formData.get("moveDate"), new Date())
    const movedCount = parseNumberInput(formData.get("headCountMoved"))

    if (!lotId || !toPenId || !moveDate || !movedCount) return
    if (!Number.isInteger(movedCount) || movedCount <= 0) return

    const lot = await prisma.lot.findFirst({
      where: {
        id: lotId,
        organizationId: orgId,
      },
      select: {
        id: true,
        ownerId: true,
        penId: true,
        headCount: true,
        exitDate: true,
        notes: true,
      },
    })

    if (!lot || lot.exitDate) return
    if (lot.penId === toPenId || movedCount > lot.headCount) return

    const targetPen = await prisma.pen.findFirst({
      where: { id: toPenId, organizationId: orgId },
      select: { id: true },
    })

    if (!targetPen) return

    await prisma.$transaction(async (tx) => {
      await tx.lotMove.create({
        data: {
          lotId: lot.id,
          fromPenId: lot.penId,
          toPenId,
          moveDate,
          headCountMoved: movedCount,
        },
      })

      if (movedCount === lot.headCount) {
        await tx.lot.update({
          where: { id: lot.id },
          data: { penId: toPenId },
        })
        return
      }

      await tx.lot.update({
        where: { id: lot.id },
        data: { headCount: lot.headCount - movedCount },
      })

      await tx.lot.create({
        data: {
          organizationId: orgId,
          ownerId: lot.ownerId,
          penId: toPenId,
          headCount: movedCount,
          arrivalDate: moveDate,
          notes: lot.notes ? `Split from ${lot.id}. ${lot.notes}` : `Split from ${lot.id}.`,
        },
      })
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function deleteLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const lotId = formData.get("lotId")?.toString()
    if (!lotId) return

    await prisma.lot.deleteMany({
      where: {
        id: lotId,
        organizationId: orgId,
      },
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ marginTop: 0 }}>Lots</h1>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Create Lot</h2>
        {owners.length === 0 || pens.length === 0 ? (
          <p>Create at least one owner and one pen before adding lots.</p>
        ) : (
          <form action={createLot} style={{ display: "grid", gap: 12 }}>
            <div style={gridStyle}>
              <select name="ownerId" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Select owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
              <select name="penId" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Select pen
                </option>
                {pens.map((pen) => (
                  <option key={pen.id} value={pen.id}>
                    {pen.name}
                  </option>
                ))}
              </select>
              <input name="headCount" placeholder="Head count" inputMode="numeric" style={inputStyle} />
              <input name="arrivalDate" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
            </div>
            <textarea name="notes" placeholder="Notes" rows={3} style={inputStyle} />
            <div>
              <button type="submit" style={buttonStyle}>
                Save Lot
              </button>
            </div>
          </form>
        )}
      </section>

      <section style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {lots.length === 0 ? (
          <p>No lots yet.</p>
        ) : (
          lots.map((lot) => (
            <article key={lot.id} style={cardStyle}>
              <div style={{ marginBottom: 12 }}>
                <strong>{lot.owner.name}</strong> in {lot.pen.name}
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Head count: {lot.headCount} | Arrival: {lot.arrivalDate.toLocaleDateString()} | Exit:{" "}
                  {lot.exitDate ? lot.exitDate.toLocaleDateString() : "Open"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Treatments: {lot._count.treatments} | Moves: {lot._count.moves}
                </div>
              </div>

              <form action={updateLot} style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="lotId" value={lot.id} />
                <div style={gridStyle}>
                  <select name="ownerId" defaultValue={lot.ownerId} style={inputStyle}>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                  <select name="penId" defaultValue={lot.penId} style={inputStyle}>
                    {pens.map((pen) => (
                      <option key={pen.id} value={pen.id}>
                        {pen.name}
                      </option>
                    ))}
                  </select>
                  <input name="headCount" defaultValue={lot.headCount} inputMode="numeric" style={inputStyle} />
                  <input
                    name="arrivalDate"
                    type="date"
                    defaultValue={toDateInputValue(lot.arrivalDate)}
                    style={inputStyle}
                  />
                  <input
                    name="exitDate"
                    type="date"
                    defaultValue={toDateInputValue(lot.exitDate)}
                    style={inputStyle}
                  />
                </div>
                <textarea name="notes" rows={3} defaultValue={lot.notes ?? ""} style={inputStyle} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" style={buttonStyle}>
                    Update Lot
                  </button>
                </div>
              </form>

              {!lot.exitDate ? (
                <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                  <form action={moveLot} style={{ display: "grid", gap: 12 }}>
                    <input type="hidden" name="lotId" value={lot.id} />
                    <div style={gridStyle}>
                      <select name="toPenId" defaultValue="" style={inputStyle}>
                        <option value="" disabled>
                          Move to pen
                        </option>
                        {pens
                          .filter((pen) => pen.id !== lot.penId)
                          .map((pen) => (
                            <option key={pen.id} value={pen.id}>
                              {pen.name}
                            </option>
                          ))}
                      </select>
                      <input
                        name="headCountMoved"
                        placeholder="Head count moved"
                        inputMode="numeric"
                        style={inputStyle}
                      />
                      <input
                        name="moveDate"
                        type="date"
                        defaultValue={toDateInputValue(new Date())}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <button type="submit" style={secondaryButtonStyle}>
                        Move / Split Lot
                      </button>
                    </div>
                  </form>

                  <form action={closeLot} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="lotId" value={lot.id} />
                    <input
                      name="exitDate"
                      type="date"
                      defaultValue={toDateInputValue(new Date())}
                      style={inputStyle}
                    />
                    <button type="submit" style={secondaryButtonStyle}>
                      Close Lot
                    </button>
                  </form>
                </div>
              ) : null}

              <form action={deleteLot} style={{ marginTop: 12 }}>
                <input type="hidden" name="lotId" value={lot.id} />
                <button type="submit" style={secondaryButtonStyle}>
                  Delete Lot
                </button>
              </form>
            </article>
          ))
        )}
      </section>
    </main>
  )
}
