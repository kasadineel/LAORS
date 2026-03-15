import Link from "next/link"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { ModuleKey } from "@prisma/client"
import { QuickSubmitButton } from "@/components/stocker/quick-submit-button"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { formatLotOptionLabel } from "@/lib/stocker-labels"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { executeLotSplit, SPLIT_TARGET_MODE } from "@/lib/stocker-split"
import {
  appendStockerSavedParam,
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  sanitizeReturnTo,
  toDateInputValue,
} from "@/lib/stocker"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  pageHeaderStyle,
  pageStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  sectionCardStyle,
  stackStyle,
} from "@/lib/stocker-ui"

type QuickMoveSplitPageProps = {
  searchParams?: Promise<{ returnTo?: string | string[] }> | { returnTo?: string | string[] }
}

export default async function QuickMoveSplitPage({ searchParams }: QuickMoveSplitPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const returnToParam = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo
  const returnTo = sanitizeReturnTo(returnToParam)
  const orgId = core.activeOrganizationId

  const [owners, lots, pens] = await Promise.all([
    prisma.owner.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lot.findMany({
      where: {
        organizationId: orgId,
        exitDate: null,
      },
      orderBy: { arrivalDate: "desc" },
      select: {
        id: true,
        ownerId: true,
        penId: true,
        headCount: true,
        arrivalDate: true,
        owner: { select: { name: true } },
        pen: { select: { id: true, name: true } },
      },
    }),
    prisma.pen.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  async function moveOrSplitLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const targetReturnTo = sanitizeReturnTo(formData.get("returnTo")?.toString())
    const sourceLotId = formData.get("lotId")?.toString()
    const destinationOwnerId = formData.get("destinationOwnerId")?.toString()
    const destinationPenId = formData.get("destinationPenId")?.toString()
    const destinationLotId = formData.get("destinationLotId")?.toString() || null
    const splitQuantity = parseNumberInput(formData.get("splitQuantity"))
    const splitDate = parseDateInput(formData.get("splitDate"), new Date())
    const notes = formData.get("notes")?.toString().trim() || null
    const targetMode = formData.get("splitTargetMode")?.toString()
    const intent = formData.get("intent")?.toString()

    if (!sourceLotId || !destinationOwnerId || !destinationPenId || !splitDate || !splitQuantity) return
    if (!Number.isInteger(splitQuantity) || splitQuantity <= 0) return
    if (targetMode !== SPLIT_TARGET_MODE.NEW && targetMode !== SPLIT_TARGET_MODE.EXISTING) return

    const result = await executeLotSplit({
      organizationId: orgId,
      createdByUserId: core.user.id,
      sourceLotId,
      splitQuantity,
      destinationOwnerId,
      destinationPenId,
      splitDate,
      notes,
      targetMode,
      destinationLotId,
    })

    if (!result) return

    revalidatePath("/dashboard/stocker")
    revalidatePath("/dashboard/stocker/lots")
    revalidatePath(`/dashboard/stocker/lots/${sourceLotId}`)
    revalidatePath(`/dashboard/stocker/lots/${result.destinationLotId}`)

    if (intent === "add-another") {
      redirect(`/dashboard/stocker/quick/move-split?returnTo=${encodeURIComponent(targetReturnTo)}`)
    }

    redirect(appendStockerSavedParam(targetReturnTo, "move-split"))
  }

  return (
    <main style={pageStyle}>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>Quick Split / Transfer</h1>
          <p style={pageSubtitleStyle}>Split part of a lot into a new or existing destination lot, including transfers to a different owner.</p>
        </div>
        <Link className="stocker-link" href={returnTo} style={{ alignSelf: "center", fontWeight: 700 }}>
          Back
        </Link>
      </div>

      <section className="stocker-section" style={{ ...sectionCardStyle, maxWidth: 760 }}>
        {lots.length === 0 || pens.length === 0 || owners.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            You need at least one open lot, one owner, and one pen before using quick split/transfer.
          </div>
        ) : (
          <form action={moveOrSplitLot} style={stackStyle}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <strong style={{ color: "var(--stocker-navy)" }}>Split between owners or lots</strong>
              <p style={{ marginBottom: 0, color: "var(--stocker-muted)" }}>
                Choose whether the split creates a new lot or adds head into an existing open lot.
              </p>
            </div>

            <div style={gridStyle}>
              <Select label="Source Lot" name="lotId" defaultValue="" required style={inputStyle}>
                <option value="" disabled>
                  Select lot
                </option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {formatLotOptionLabel({
                      ownerName: lot.owner.name,
                      penName: lot.pen.name,
                      arrivalDate: lot.arrivalDate,
                      headCount: lot.headCount,
                    })}
                  </option>
                ))}
              </Select>

              <Select label="Split Into" name="splitTargetMode" defaultValue={SPLIT_TARGET_MODE.NEW} required style={inputStyle}>
                <option value={SPLIT_TARGET_MODE.NEW}>Create New Lot</option>
                <option value={SPLIT_TARGET_MODE.EXISTING}>Add to Existing Lot</option>
              </Select>

              <Select label="Destination Owner" name="destinationOwnerId" defaultValue="" required style={inputStyle}>
                <option value="" disabled>
                  Select owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>

              <Select label="Destination Pen" name="destinationPenId" defaultValue="" required style={inputStyle}>
                <option value="" disabled>
                  Select pen
                </option>
                {pens.map((pen) => (
                  <option key={pen.id} value={pen.id}>
                    {pen.name}
                  </option>
                ))}
              </Select>

              <Select label="Existing Destination Lot" name="destinationLotId" defaultValue="" style={inputStyle}>
                <option value="">Create new lot</option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {formatLotOptionLabel({
                      ownerName: lot.owner.name,
                      penName: lot.pen.name,
                      arrivalDate: lot.arrivalDate,
                      headCount: lot.headCount,
                    })}
                  </option>
                ))}
              </Select>

              <Input
                label="Quantity to Split"
                type="number"
                name="splitQuantity"
                min="1"
                step="1"
                inputMode="numeric"
                required
                style={inputStyle}
              />

              <Input
                label="Split Date"
                type="date"
                name="splitDate"
                defaultValue={toDateInputValue(new Date())}
                required
                style={inputStyle}
              />
            </div>

            <Textarea
              label="Notes"
              name="notes"
              rows={2}
              placeholder="Reason for owner transfer or split"
              style={inputStyle}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <QuickSubmitButton>Save &amp; Return</QuickSubmitButton>
              <Button
                type="submit"
                name="intent"
                value="add-another"
                variant="secondary"
              >
                Save &amp; Add Another
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
