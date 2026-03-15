import Link from "next/link"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { LotLedgerEventType, ModuleKey, StockerActivityType } from "@prisma/client"
import { QuickSubmitButton } from "@/components/stocker/quick-submit-button"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { logStockerActivity } from "@/lib/stocker-activity"
import { recordLotLedgerEvent } from "@/lib/stocker-ledger"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
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

type QuickIntakePageProps = {
  searchParams?: Promise<{ returnTo?: string | string[] }> | { returnTo?: string | string[] }
}

export default async function QuickIntakePage({ searchParams }: QuickIntakePageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const returnToParam = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo
  const returnTo = sanitizeReturnTo(returnToParam)
  const orgId = core.activeOrganizationId

  const [owners, pens] = await Promise.all([
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
  ])

  async function createQuickLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const targetReturnTo = sanitizeReturnTo(formData.get("returnTo")?.toString())
    const ownerId = formData.get("ownerId")?.toString()
    const penId = formData.get("penId")?.toString()
    const headCount = parseNumberInput(formData.get("headCount"))
    const inTotalWeight = parseNumberInput(formData.get("inTotalWeight"))
    const arrivalDate = parseDateInput(formData.get("arrivalDate"))
    const intent = formData.get("intent")?.toString()

    if (!ownerId || !penId || !headCount || !arrivalDate) return
    if (!Number.isInteger(headCount) || headCount <= 0) return

    const [owner, pen] = await Promise.all([
      prisma.owner.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true, name: true } }),
      prisma.pen.findFirst({ where: { id: penId, organizationId: orgId }, select: { id: true, name: true } }),
    ])

    if (!owner || !pen) return

    await prisma.$transaction(async (tx) => {
      const lot = await tx.lot.create({
        data: {
          organizationId: orgId,
          ownerId,
          penId,
          headCount,
          inHeadCount: headCount,
          inTotalWeight,
          arrivalDate,
        },
      })

      await recordLotLedgerEvent(
        {
          organizationId: orgId,
          lotId: lot.id,
          eventType: LotLedgerEventType.INTAKE,
          eventDate: arrivalDate,
          headChange: headCount,
          headAfter: headCount,
          createdById: core.user.id,
          relatedOwnerId: ownerId,
          relatedPenId: penId,
          metadata: {
            ownerId,
            ownerName: owner.name,
            penId,
            penName: pen.name,
            headCount,
            inHeadCount: headCount,
            inTotalWeight,
            arrivalDate: arrivalDate.toISOString(),
          },
        },
        tx,
      )

      await logStockerActivity(
        {
          organizationId: orgId,
          type: StockerActivityType.INTAKE,
          message: `${headCount} head received for ${owner.name} into ${pen.name}.`,
          metadata: {
            lotId: lot.id,
            ownerId,
            ownerName: owner.name,
            penId,
            penName: pen.name,
            headCount,
            inHeadCount: headCount,
            inTotalWeight,
            arrivalDate: arrivalDate.toISOString(),
          },
          createdByUserId: core.user.id,
        },
        tx,
      )
    })

    revalidatePath("/dashboard/stocker")
    revalidatePath("/dashboard/stocker/lots")

    if (intent === "add-another") {
      redirect(`/dashboard/stocker/quick/intake?returnTo=${encodeURIComponent(targetReturnTo)}`)
    }

    redirect(appendStockerSavedParam(targetReturnTo, "intake"))
  }

  return (
    <main style={pageStyle}>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>Quick Intake</h1>
          <p style={pageSubtitleStyle}>Add a new lot with only the fields needed to get cattle in the yard.</p>
        </div>
        <Link className="stocker-link" href={returnTo} style={{ alignSelf: "center", fontWeight: 700 }}>
          Back
        </Link>
      </div>

      <section className="stocker-section" style={{ ...sectionCardStyle, maxWidth: 720 }}>
        {owners.length === 0 || pens.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Create at least one owner and one pen before using quick intake.
          </div>
        ) : (
          <form action={createQuickLot} style={stackStyle}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <strong style={{ color: "var(--stocker-navy)" }}>Required fields only</strong>
              <p style={{ marginBottom: 0, color: "var(--stocker-muted)" }}>
                Dropdowns are preloaded for fast entry. Invalid fields are highlighted before submit.
              </p>
            </div>

            <div style={gridStyle}>
              <Select label="Owner" name="ownerId" defaultValue="" required style={inputStyle}>
                <option value="" disabled>
                  Select owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>

              <Select label="Pen" name="penId" defaultValue="" required style={inputStyle}>
                <option value="" disabled>
                  Select pen
                </option>
                {pens.map((pen) => (
                  <option key={pen.id} value={pen.id}>
                    {pen.name}
                  </option>
                ))}
              </Select>

              <Input
                label="Head count"
                type="number"
                name="headCount"
                min="1"
                step="1"
                inputMode="numeric"
                required
                style={inputStyle}
              />

              <Input
                label="Total In Weight (lbs)"
                type="number"
                name="inTotalWeight"
                min="0"
                step="0.1"
                inputMode="decimal"
                style={inputStyle}
              />

              <Input
                label="Arrival date"
                type="date"
                name="arrivalDate"
                defaultValue={toDateInputValue(new Date())}
                required
                style={inputStyle}
              />
            </div>

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
