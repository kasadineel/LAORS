import Link from "next/link"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { LotAdjustmentDirection, LotAdjustmentType, ModuleKey } from "@prisma/client"
import { QuickSubmitButton } from "@/components/stocker/quick-submit-button"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { formatLotOptionLabel } from "@/lib/stocker-labels"
import { adjustStockerLotHeadCount } from "@/lib/stocker-lot-actions"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
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

type QuickAdjustPageProps = {
  searchParams?: Promise<{ returnTo?: string | string[] }> | { returnTo?: string | string[] }
}

const LOT_ADJUSTMENT_TYPE_OPTIONS = [
  { value: LotAdjustmentType.DEATH_LOSS, label: "Death loss" },
  { value: LotAdjustmentType.OWNER_PICKUP, label: "Owner pickup" },
  { value: LotAdjustmentType.SHIPMENT_OUT, label: "Shipment out" },
  { value: LotAdjustmentType.ADDITION, label: "Addition received" },
  { value: LotAdjustmentType.COUNT_CORRECTION, label: "Count correction" },
  { value: LotAdjustmentType.OTHER, label: "Other" },
] as const

export default async function QuickAdjustPage({ searchParams }: QuickAdjustPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const returnToParam = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo
  const returnTo = sanitizeReturnTo(returnToParam)
  const orgId = core.activeOrganizationId

  const lots = await prisma.lot.findMany({
    where: {
      organizationId: orgId,
      exitDate: null,
    },
    orderBy: { arrivalDate: "desc" },
    select: {
      id: true,
      headCount: true,
      arrivalDate: true,
      owner: { select: { name: true } },
      pen: { select: { name: true } },
    },
  })

  async function createQuickAdjustment(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const targetReturnTo = sanitizeReturnTo(formData.get("returnTo")?.toString())
    const lotId = formData.get("lotId")?.toString()
    const adjustmentType = formData.get("adjustmentType")?.toString() as LotAdjustmentType | undefined
    const requestedDirection = formData.get("direction")?.toString() as LotAdjustmentDirection | undefined
    const quantity = parseNumberInput(formData.get("quantity"))
    const adjustmentDate = parseDateInput(formData.get("adjustmentDate"), new Date())
    const notes = formData.get("notes")?.toString().trim() || null
    const intent = formData.get("intent")?.toString()

    if (!lotId || !adjustmentType || !adjustmentDate || quantity === null) return
    if (!Number.isInteger(quantity) || quantity <= 0) return

    const result = await adjustStockerLotHeadCount({
      organizationId: orgId,
      lotId,
      adjustmentType,
      quantity,
      adjustmentDate,
      requestedDirection,
      notes,
      createdByUserId: core.user.id,
    })

    if (!result) return

    revalidatePath("/dashboard/stocker")
    revalidatePath("/dashboard/stocker/lots")
    revalidatePath(`/dashboard/stocker/lots/${lotId}`)

    if (intent === "add-another") {
      redirect(`/dashboard/stocker/quick/adjust?returnTo=${encodeURIComponent(targetReturnTo)}`)
    }

    redirect(appendStockerSavedParam(targetReturnTo, "adjustment"))
  }

  return (
    <main style={pageStyle}>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>Quick Adjustment</h1>
          <p style={pageSubtitleStyle}>Correct lot counts, log death loss, owner pickup, additions, or shipment changes from one focused screen.</p>
        </div>
        <Link className="stocker-link" href={returnTo} style={{ alignSelf: "center", fontWeight: 700 }}>
          Back
        </Link>
      </div>

      <section className="stocker-section" style={{ ...sectionCardStyle, maxWidth: 760 }}>
        {lots.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            You need at least one open lot before logging an adjustment.
          </div>
        ) : (
          <form action={createQuickAdjustment} style={stackStyle}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <strong style={{ color: "var(--stocker-navy)" }}>Fast head count change</strong>
              <p style={{ marginBottom: 0, color: "var(--stocker-muted)" }}>
                Use this when you need to change count without opening the full lot record. The lot ledger and activity trail update automatically.
              </p>
            </div>

            <div style={gridStyle}>
              <Select label="Lot" name="lotId" defaultValue="" required style={inputStyle}>
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

              <Select label="Adjustment type" name="adjustmentType" defaultValue="" required style={inputStyle}>
                <option value="" disabled>
                  Adjustment type
                </option>
                {LOT_ADJUSTMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <Select label="Direction" name="direction" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Use only for corrections or other
                </option>
                <option value={LotAdjustmentDirection.OUT}>Reduce head</option>
                <option value={LotAdjustmentDirection.IN}>Add head</option>
              </Select>

              <Input
                label="Quantity"
                type="number"
                name="quantity"
                min="1"
                step="1"
                inputMode="numeric"
                required
                style={inputStyle}
              />

              <Input
                label="Adjustment date"
                type="date"
                name="adjustmentDate"
                defaultValue={toDateInputValue(new Date())}
                required
                style={inputStyle}
              />
            </div>

            <Textarea
              label="Notes"
              name="notes"
              rows={2}
              placeholder="Reason for the count change"
              style={inputStyle}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <QuickSubmitButton>Save &amp; Return</QuickSubmitButton>
              <Button type="submit" name="intent" value="add-another" variant="secondary">
                Save &amp; Add Another
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
