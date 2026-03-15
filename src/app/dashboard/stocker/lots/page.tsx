import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { LotAdjustmentDirection, LotAdjustmentType, LotLedgerEventType, ModuleKey, StockerActivityType } from "@prisma/client"
import { logStockerActivity } from "@/lib/stocker-activity"
import { getLotLedgerEventTypeForAdjustment, recordLotLedgerEvent } from "@/lib/stocker-ledger"
import {
  formatAverageWeightLbs,
  formatLotLabel,
  formatTotalWeightLbs,
  getLotAdjustmentTypeLabel,
} from "@/lib/stocker-labels"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { executeLotSplit, SPLIT_TARGET_MODE } from "@/lib/stocker-split"
import {
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  toDateInputValue,
} from "@/lib/stocker"
import { getEffectiveOutHeadCount } from "@/lib/stocker-weights"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  metaTextStyle,
  pageStyle,
  stackStyle,
} from "@/lib/stocker-ui"

export default async function LotsPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
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
        inHeadCount: true,
        inTotalWeight: true,
        outHeadCount: true,
        outTotalWeight: true,
        arrivalDate: true,
        exitDate: true,
        notes: true,
        ownerId: true,
        penId: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
        adjustments: {
          orderBy: [{ adjustmentDate: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            id: true,
            type: true,
            direction: true,
            quantity: true,
            adjustmentDate: true,
            notes: true,
          },
        },
        _count: {
          select: {
            treatments: true,
            moves: true,
            adjustments: true,
          },
        },
      },
    }),
  ])

  async function createLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const ownerId = formData.get("ownerId")?.toString()
    const penId = formData.get("penId")?.toString()
    const headCount = parseNumberInput(formData.get("headCount"))
    const inTotalWeight = parseNumberInput(formData.get("inTotalWeight"))
    const arrivalDate = parseDateInput(formData.get("arrivalDate"))
    const notes = formData.get("notes")?.toString().trim() || null

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
          notes,
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
          notes,
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

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function updateLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const lotId = formData.get("lotId")?.toString()
    const ownerId = formData.get("ownerId")?.toString()
    const penId = formData.get("penId")?.toString()
    const inTotalWeight = parseNumberInput(formData.get("inTotalWeight"))
    const outHeadCount = parseNumberInput(formData.get("outHeadCount"))
    const outTotalWeight = parseNumberInput(formData.get("outTotalWeight"))
    const arrivalDate = parseDateInput(formData.get("arrivalDate"))
    const exitDate = parseDateInput(formData.get("exitDate"))
    const notes = formData.get("notes")?.toString().trim() || null

    if (!lotId || !ownerId || !penId || !arrivalDate) return
    if (outHeadCount !== null && (!Number.isInteger(outHeadCount) || outHeadCount <= 0)) return

    const [owner, pen, existingLot] = await Promise.all([
      prisma.owner.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true } }),
      prisma.pen.findFirst({ where: { id: penId, organizationId: orgId }, select: { id: true } }),
      prisma.lot.findFirst({
        where: { id: lotId, organizationId: orgId },
        select: { id: true, headCount: true, inHeadCount: true, ownerId: true, penId: true },
      }),
    ])

    if (!owner || !pen || !existingLot) return
    if (ownerId !== existingLot.ownerId || penId !== existingLot.penId) return
    if (outHeadCount !== null && outHeadCount > existingLot.headCount) return

    await prisma.lot.updateMany({
      where: {
        id: lotId,
        organizationId: orgId,
      },
      data: {
        ownerId: existingLot.ownerId,
        penId: existingLot.penId,
        inHeadCount: inTotalWeight === null ? null : existingLot.inHeadCount ?? existingLot.headCount,
        inTotalWeight,
        outHeadCount,
        outTotalWeight,
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
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const lotId = formData.get("lotId")?.toString()
    const exitDate = parseDateInput(formData.get("exitDate"), new Date())
    const outTotalWeight = parseNumberInput(formData.get("outTotalWeight"))
    const outHeadCountInput = parseNumberInput(formData.get("outHeadCount"))
    if (!lotId || !exitDate) return
    if (outHeadCountInput !== null && (!Number.isInteger(outHeadCountInput) || outHeadCountInput <= 0)) return

    const lot = await prisma.lot.findFirst({
      where: {
        id: lotId,
        organizationId: orgId,
      },
      select: {
        id: true,
        headCount: true,
        inHeadCount: true,
        inTotalWeight: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
      },
    })

    if (!lot) return
    const outHeadCount = outHeadCountInput ?? lot.headCount
    if (outHeadCount > lot.headCount) return

    await prisma.$transaction(async (tx) => {
      await tx.lot.updateMany({
        where: {
          id: lotId,
          organizationId: orgId,
        },
        data: { exitDate, outHeadCount, outTotalWeight },
      })

      await recordLotLedgerEvent(
        {
          organizationId: orgId,
          lotId: lot.id,
          eventType: LotLedgerEventType.CLOSE,
          eventDate: exitDate,
          headChange: 0,
          headAfter: lot.headCount,
          createdById: core.user.id,
          metadata: {
            headCount: lot.headCount,
            inHeadCount: lot.inHeadCount ?? lot.headCount,
            inTotalWeight: lot.inTotalWeight,
            outHeadCount,
            outTotalWeight,
            ownerName: lot.owner.name,
            penName: lot.pen.name,
            exitDate: exitDate.toISOString(),
          },
        },
        tx,
      )

      await logStockerActivity(
        {
          organizationId: orgId,
          type: StockerActivityType.CLOSE_LOT,
          message: `Closed ${formatLotLabel({ ownerName: lot.owner.name, penName: lot.pen.name })}.`,
          metadata: {
            lotId: lot.id,
            headCount: lot.headCount,
            inHeadCount: lot.inHeadCount ?? lot.headCount,
            inTotalWeight: lot.inTotalWeight,
            outHeadCount,
            outTotalWeight,
            ownerName: lot.owner.name,
            penName: lot.pen.name,
            exitDate: exitDate.toISOString(),
          },
          createdByUserId: core.user.id,
        },
        tx,
      )
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function splitLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const sourceLotId = formData.get("lotId")?.toString()
    const destinationOwnerId = formData.get("destinationOwnerId")?.toString()
    const destinationPenId = formData.get("destinationPenId")?.toString()
    const destinationLotId = formData.get("destinationLotId")?.toString() || null
    const splitQuantity = parseNumberInput(formData.get("splitQuantity"))
    const splitDate = parseDateInput(formData.get("splitDate"), new Date())
    const notes = formData.get("notes")?.toString().trim() || null
    const targetMode = formData.get("splitTargetMode")?.toString()

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

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
    revalidatePath(`/dashboard/stocker/lots/${sourceLotId}`)
    revalidatePath(`/dashboard/stocker/lots/${result.destinationLotId}`)
  }

  async function adjustLotHeadCount(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const lotId = formData.get("lotId")?.toString()
    const adjustmentType = formData.get("adjustmentType")?.toString() as LotAdjustmentType | undefined
    const quantity = parseNumberInput(formData.get("quantity"))
    const adjustmentDate = parseDateInput(formData.get("adjustmentDate"), new Date())
    const notes = formData.get("notes")?.toString().trim() || null
    const requestedDirection = formData.get("direction")?.toString() as LotAdjustmentDirection | undefined

    if (!lotId || !adjustmentType || !adjustmentDate || quantity === null) return
    if (!Number.isInteger(quantity) || quantity <= 0) return

    const direction = resolveAdjustmentDirection(adjustmentType, requestedDirection)
    if (!direction) return

    const lot = await prisma.lot.findFirst({
      where: {
        id: lotId,
        organizationId: orgId,
      },
      select: {
        id: true,
        headCount: true,
        exitDate: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
      },
    })

    if (!lot || lot.exitDate) return

    const nextHeadCount =
      direction === LotAdjustmentDirection.IN ? lot.headCount + quantity : lot.headCount - quantity

    if (nextHeadCount < 0 || (direction === LotAdjustmentDirection.OUT && quantity > lot.headCount)) return

    await prisma.$transaction(async (tx) => {
      await tx.lotAdjustment.create({
        data: {
          organizationId: orgId,
          lotId: lot.id,
          type: adjustmentType,
          direction,
          quantity,
          adjustmentDate,
          notes,
          createdById: core.user.id,
        },
      })

      await tx.lot.update({
        where: { id: lot.id },
        data: { headCount: nextHeadCount },
      })

      await recordLotLedgerEvent(
        {
          organizationId: orgId,
          lotId: lot.id,
          eventType: getLotLedgerEventTypeForAdjustment(adjustmentType),
          eventDate: adjustmentDate,
          headChange: direction === LotAdjustmentDirection.IN ? quantity : -quantity,
          headAfter: nextHeadCount,
          notes,
          createdById: core.user.id,
          metadata: {
            ownerName: lot.owner.name,
            penName: lot.pen.name,
            type: adjustmentType,
            direction,
            quantity,
            previousHeadCount: lot.headCount,
            currentHeadCount: nextHeadCount,
            adjustmentDate: adjustmentDate.toISOString(),
            notes,
          },
        },
        tx,
      )

      await logStockerActivity(
        {
          organizationId: orgId,
          type: StockerActivityType.LOT_ADJUSTMENT,
          message: `Adjusted ${formatLotLabel({ ownerName: lot.owner.name, penName: lot.pen.name })}: ${direction === LotAdjustmentDirection.IN ? "+" : "-"}${quantity} head for ${getLotAdjustmentTypeLabel(adjustmentType).toLowerCase()}.`,
          metadata: {
            lotId: lot.id,
            ownerName: lot.owner.name,
            penName: lot.pen.name,
            type: adjustmentType,
            direction,
            quantity,
            previousHeadCount: lot.headCount,
            currentHeadCount: nextHeadCount,
            adjustmentDate: adjustmentDate.toISOString(),
            notes,
          },
          createdByUserId: core.user.id,
        },
        tx,
      )
    })

    revalidatePath("/dashboard/stocker/lots")
    revalidatePath("/dashboard/stocker")
  }

  async function deleteLot(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

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
      <PageHeader
        title="Lots"
        subtitle="Manage arrivals, exits, moves, and split lots across pens."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
      />
      <ActionBar
        primaryAction={{ href: "#intake-lot", label: "+ Intake Lot" }}
        secondaryActions={[{ href: "/dashboard/stocker/quick/move-split", label: "Quick Split / Transfer" }]}
      />

      <CardSection id="intake-lot" title="Intake Lot">
        {owners.length === 0 || pens.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Create at least one owner and one pen before adding lots.
          </div>
        ) : (
          <form action={createLot} style={stackStyle}>
            <div style={gridStyle}>
              <Select label="Owner" name="ownerId" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Select owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>
              <Select label="Pen" name="penId" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Select pen
                </option>
                {pens.map((pen) => (
                  <option key={pen.id} value={pen.id}>
                    {pen.name}
                  </option>
                ))}
              </Select>
              <Input label="Head count" name="headCount" inputMode="numeric" style={inputStyle} />
              <Input
                label="Total In Weight (lbs)"
                name="inTotalWeight"
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                style={inputStyle}
              />
              <Input label="Arrival date" name="arrivalDate" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
            </div>
            <Textarea label="Notes" name="notes" placeholder="Notes" rows={3} style={inputStyle} />
            <div>
              <Button type="submit" variant="primary">
                Save Lot
              </Button>
            </div>
          </form>
        )}
      </CardSection>

      <CardSection title="Lot Registry">
        {lots.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No lots currently active.</strong>
            Intake your first lot to begin tracking cattle.
          </div>
        ) : (
          <div style={stackStyle}>
            {lots.map((lot) => {
              const effectiveOutHeadCount = getEffectiveOutHeadCount(lot.outHeadCount, lot.headCount)

              return (
                <article key={lot.id} className="stocker-card" style={cardStyle}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <strong style={{ color: "var(--stocker-navy)" }}>
                        {formatLotLabel({
                          ownerName: lot.owner.name,
                          penName: lot.pen.name,
                          arrivalDate: lot.arrivalDate,
                        })}
                      </strong>
                      <Button href={`/dashboard/stocker/lots/${lot.id}`} variant="secondary" size="sm">
                        View Lot Detail
                      </Button>
                    </div>
                    <div style={metaTextStyle}>
                      Current head count: {lot.headCount} | Status: {lot.exitDate ? "Closed" : "Open"} | Arrival: {lot.arrivalDate.toLocaleDateString()} | Exit:{" "}
                      {lot.exitDate ? lot.exitDate.toLocaleDateString() : "Open"}
                    </div>
                    <div style={metaTextStyle}>
                      In total: {formatTotalWeightLbs(lot.inTotalWeight)} | Avg in:{" "}
                      {formatAverageWeightLbs(lot.inTotalWeight, lot.inHeadCount ?? lot.headCount)}
                    </div>
                    <div style={metaTextStyle}>
                      Out head count: {effectiveOutHeadCount ?? "Not recorded"} | Out total: {formatTotalWeightLbs(lot.outTotalWeight)} | Avg out:{" "}
                      {formatAverageWeightLbs(lot.outTotalWeight, effectiveOutHeadCount)}
                    </div>
                    <div style={metaTextStyle}>
                      Last adjustment: {lot.adjustments[0] ? lot.adjustments[0].adjustmentDate.toLocaleDateString() : "None"}
                    </div>
                    <div style={metaTextStyle}>
                      Treatments: {lot._count.treatments} | Moves: {lot._count.moves} | Adjustments: {lot._count.adjustments}
                    </div>
                  </div>

                  <form action={updateLot} style={stackStyle}>
                    <input type="hidden" name="lotId" value={lot.id} />
                    <input type="hidden" name="ownerId" value={lot.ownerId} />
                    <input type="hidden" name="penId" value={lot.penId} />
                    <div style={gridStyle}>
                      <Input label="Owner" value={lot.owner.name} disabled style={inputStyle} />
                      <Input label="Pen" value={lot.pen.name} disabled style={inputStyle} />
                      <Input
                        label="Arrival date"
                        name="arrivalDate"
                        type="date"
                        defaultValue={toDateInputValue(lot.arrivalDate)}
                        style={inputStyle}
                      />
                      <Input
                        label="Total In Weight (lbs)"
                        name="inTotalWeight"
                        type="number"
                        min="0"
                        step="0.1"
                        inputMode="decimal"
                        defaultValue={lot.inTotalWeight ?? ""}
                        style={inputStyle}
                      />
                      <Input
                        label="Exit date"
                        name="exitDate"
                        type="date"
                        defaultValue={toDateInputValue(lot.exitDate)}
                        style={inputStyle}
                      />
                      <Input
                        label="Out Head Count"
                        name="outHeadCount"
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        defaultValue={lot.outHeadCount ?? ""}
                        style={inputStyle}
                      />
                      <Input
                        label="Total Out Weight (lbs)"
                        name="outTotalWeight"
                        type="number"
                        min="0"
                        step="0.1"
                        inputMode="decimal"
                        defaultValue={lot.outTotalWeight ?? ""}
                        style={inputStyle}
                      />
                    </div>
                    <div style={metaTextStyle}>Use Split / Transfer to change owner or pen so inventory history stays traceable.</div>
                    <Textarea label="Notes" name="notes" rows={3} defaultValue={lot.notes ?? ""} style={inputStyle} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button type="submit" variant="primary">
                        Update Lot Details
                      </Button>
                    </div>
                  </form>

                  {!lot.exitDate ? (
                    <div style={{ marginTop: 16, ...stackStyle }}>
                      <form action={adjustLotHeadCount} style={stackStyle}>
                        <input type="hidden" name="lotId" value={lot.id} />
                        <div style={gridStyle}>
                          <Select label="Adjustment type" name="adjustmentType" defaultValue="" style={inputStyle}>
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
                              Direction
                            </option>
                            <option value={LotAdjustmentDirection.OUT}>Reduce head</option>
                            <option value={LotAdjustmentDirection.IN}>Add head</option>
                          </Select>
                          <Input
                            label="Quantity"
                            name="quantity"
                            inputMode="numeric"
                            style={inputStyle}
                          />
                          <Input
                            label="Adjustment date"
                            name="adjustmentDate"
                            type="date"
                            defaultValue={toDateInputValue(new Date())}
                            style={inputStyle}
                          />
                        </div>
                        <Textarea
                          label="Adjustment notes"
                          name="notes"
                          rows={2}
                          placeholder="Notes (death loss, owner pickup, correction reason)"
                          style={inputStyle}
                        />
                        <div>
                          <Button type="submit" variant="secondary">
                            Adjust Head Count
                          </Button>
                        </div>
                      </form>

                      <form action={splitLot} style={stackStyle}>
                        <input type="hidden" name="lotId" value={lot.id} />
                        <div style={gridStyle}>
                          <Select label="Quantity to Split" name="splitQuantity" defaultValue="" style={inputStyle}>
                            <option value="" disabled>
                              Select quantity
                            </option>
                            {Array.from({ length: lot.headCount }, (_, index) => index + 1).map((count) => (
                              <option key={count} value={count}>
                                {count} head
                              </option>
                            ))}
                          </Select>
                          <Select label="Destination Owner" name="destinationOwnerId" defaultValue={lot.ownerId} style={inputStyle}>
                            {owners.map((owner) => (
                              <option key={owner.id} value={owner.id}>
                                {owner.name}
                              </option>
                            ))}
                          </Select>
                          <Select label="Destination Pen" name="destinationPenId" defaultValue={lot.penId} style={inputStyle}>
                            {pens.map((pen) => (
                              <option key={pen.id} value={pen.id}>
                                {pen.name}
                              </option>
                            ))}
                          </Select>
                          <Select label="Split Into" name="splitTargetMode" defaultValue={SPLIT_TARGET_MODE.NEW} style={inputStyle}>
                            <option value={SPLIT_TARGET_MODE.NEW}>Create New Lot</option>
                            <option value={SPLIT_TARGET_MODE.EXISTING}>Add to Existing Lot</option>
                          </Select>
                          <Select label="Existing Destination Lot" name="destinationLotId" defaultValue="" style={inputStyle}>
                            <option value="">Create new lot</option>
                            {lots
                              .filter((candidateLot) => candidateLot.id !== lot.id && !candidateLot.exitDate)
                              .map((candidateLot) => (
                                <option key={candidateLot.id} value={candidateLot.id}>
                                  {formatLotLabel({
                                    ownerName: candidateLot.owner.name,
                                    penName: candidateLot.pen.name,
                                    arrivalDate: candidateLot.arrivalDate,
                                  })}{" "}
                                  · {candidateLot.headCount} head
                                </option>
                              ))}
                          </Select>
                          <Input
                            label="Split Date"
                            name="splitDate"
                            type="date"
                            defaultValue={toDateInputValue(new Date())}
                            style={inputStyle}
                          />
                        </div>
                        <Textarea
                          label="Split Notes"
                          name="notes"
                          rows={2}
                          placeholder="Reason for owner transfer or split"
                          style={inputStyle}
                        />
                        <div>
                          <Button type="submit" variant="secondary">
                            Split / Transfer Lot
                          </Button>
                        </div>
                      </form>

                      <form action={closeLot} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input type="hidden" name="lotId" value={lot.id} />
                        <Input
                          label="Exit date"
                          name="exitDate"
                          type="date"
                          defaultValue={toDateInputValue(new Date())}
                          style={inputStyle}
                        />
                        <Input
                          label="Out Head Count"
                          name="outHeadCount"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          defaultValue={effectiveOutHeadCount ?? lot.headCount}
                          style={inputStyle}
                        />
                        <Input
                          label="Total Out Weight (lbs)"
                          name="outTotalWeight"
                          type="number"
                          min="0"
                          step="0.1"
                          inputMode="decimal"
                          defaultValue={lot.outTotalWeight ?? ""}
                          style={inputStyle}
                        />
                        <Button type="submit" variant="secondary">
                          Close Lot
                        </Button>
                      </form>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 16 }}>
                    <div style={{ ...metaTextStyle, marginBottom: 8 }}>Recent adjustments</div>
                    {lot.adjustments.length === 0 ? (
                      <div style={metaTextStyle}>No head count adjustments recorded yet.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {lot.adjustments.map((adjustment) => (
                          <div key={adjustment.id} style={{ borderTop: "1px solid rgba(11, 45, 69, 0.08)", paddingTop: 8 }}>
                            <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>
                              {adjustment.direction === LotAdjustmentDirection.IN ? "+" : "-"}
                              {adjustment.quantity} head · {getLotAdjustmentTypeLabel(adjustment.type)}
                            </div>
                            <div style={metaTextStyle}>
                              {adjustment.adjustmentDate.toLocaleDateString()}
                              {adjustment.notes ? ` | ${adjustment.notes}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <form action={deleteLot} style={{ marginTop: 12 }}>
                    <input type="hidden" name="lotId" value={lot.id} />
                    <Button type="submit" variant="secondary">
                      Delete Lot
                    </Button>
                  </form>
                </article>
              )
            })}
          </div>
        )}
      </CardSection>
    </main>
  )
}

const LOT_ADJUSTMENT_TYPE_OPTIONS = [
  { value: LotAdjustmentType.DEATH_LOSS, label: "Death loss" },
  { value: LotAdjustmentType.OWNER_PICKUP, label: "Owner pickup" },
  { value: LotAdjustmentType.SHIPMENT_OUT, label: "Shipment out" },
  { value: LotAdjustmentType.ADDITION, label: "Addition received" },
  { value: LotAdjustmentType.COUNT_CORRECTION, label: "Count correction" },
  { value: LotAdjustmentType.OTHER, label: "Other" },
] as const

function resolveAdjustmentDirection(
  type: LotAdjustmentType,
  requestedDirection?: LotAdjustmentDirection,
) {
  if (type === LotAdjustmentType.DEATH_LOSS || type === LotAdjustmentType.OWNER_PICKUP || type === LotAdjustmentType.SHIPMENT_OUT) {
    return LotAdjustmentDirection.OUT
  }

  if (type === LotAdjustmentType.ADDITION) {
    return LotAdjustmentDirection.IN
  }

  if (type === LotAdjustmentType.COUNT_CORRECTION || type === LotAdjustmentType.OTHER) {
    return requestedDirection ?? null
  }

  return null
}
