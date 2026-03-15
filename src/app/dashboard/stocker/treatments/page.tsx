import { revalidatePath } from "next/cache"
import { MedicineBillingMode, ModuleKey, StockerActivityType } from "@prisma/client"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { TreatmentEntryForm } from "@/components/stocker/treatment-entry-form"
import { Button } from "@/components/stocker/ui/Button"
import { logStockerActivity } from "@/lib/stocker-activity"
import { formatLotLabel } from "@/lib/stocker-labels"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER, ROLE_WORKER } from "@/lib/permissions"
import { getMedicineDelegate, prisma } from "@/lib/prisma"
import { parseDateInput, parseNumberInput, requireStockerAccess, toDateInputValue } from "@/lib/stocker"
import { calculateBillableAmount, calculateTotalUnitsUsed, formatMoney, getMedicineBillingModeLabel } from "@/lib/treatment-pricing"
import { cardStyle, emptyStateStyle, metaTextStyle, pageStyle, stackStyle } from "@/lib/stocker-ui"

export default async function TreatmentsPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER, ROLE_WORKER])
  const orgId = core.activeOrganizationId
  const userId = core.user.id
  const medicineDelegate = getMedicineDelegate()

  const [lots, medicines, treatments] = await Promise.all([
    prisma.lot.findMany({
      where: { organizationId: orgId },
      orderBy: { arrivalDate: "desc" },
      select: {
        id: true,
        headCount: true,
        arrivalDate: true,
        owner: { select: { name: true } },
        pen: { select: { name: true } },
      },
    }),
    medicineDelegate.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unitLabel: true,
        costPerUnit: true,
        billingMode: true,
        chargePerUnit: true,
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
        medicineId: true,
        headTreated: true,
        dosePerHead: true,
        totalUnitsUsed: true,
        costPerUnitSnapshot: true,
        billingModeSnapshot: true,
        chargePerUnitSnapshot: true,
        billableAmount: true,
        date: true,
        notes: true,
        medicineRecord: {
          select: {
            unitLabel: true,
          },
        },
        lot: {
          select: {
            id: true,
            headCount: true,
            arrivalDate: true,
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
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER, ROLE_WORKER],
    })

    const lotId = formData.get("lotId")?.toString()
    const medicineId = formData.get("medicineId")?.toString()
    const headTreatedValue = parseNumberInput(formData.get("headTreated"))
    const dosePerHead = parseNumberInput(formData.get("dosePerHead"))
    const date = parseDateInput(formData.get("date"), new Date())
    const notes = formData.get("notes")?.toString().trim() || null

    if (!lotId || !medicineId || headTreatedValue === null || dosePerHead === null || !date) return

    const headTreated = Math.trunc(headTreatedValue)
    if (headTreated < 1) return

    const [lot, medicine] = await Promise.all([
      prisma.lot.findFirst({
        where: { id: lotId, organizationId: orgId },
        select: {
          id: true,
          headCount: true,
          owner: { select: { name: true } },
          pen: { select: { name: true } },
        },
      }),
      prisma.medicine.findFirst({
        where: { id: medicineId, organizationId: orgId, isActive: true },
        select: {
          id: true,
          name: true,
          unitLabel: true,
          costPerUnit: true,
          billingMode: true,
          chargePerUnit: true,
        },
      }),
    ])

    if (!lot || !medicine || headTreated > lot.headCount) return

    const totalUnitsUsed = calculateTotalUnitsUsed(headTreated, dosePerHead)
    const billableAmount = calculateBillableAmount({
      headTreated,
      dosePerHead,
      costPerUnit: medicine.costPerUnit,
      billingMode: medicine.billingMode,
      chargePerUnit: medicine.chargePerUnit,
    })

    await prisma.$transaction(async (tx) => {
      await tx.treatment.create({
        data: {
          lotId,
          medicineId: medicine.id,
          medicine: medicine.name,
          headTreated,
          dosePerHead,
          totalUnitsUsed,
          costPerUnitSnapshot: medicine.costPerUnit,
          billingModeSnapshot: medicine.billingMode,
          chargePerUnitSnapshot: medicine.chargePerUnit,
          billableAmount,
          date,
          notes,
        },
      })

      await logStockerActivity(
        {
          organizationId: orgId,
          type: StockerActivityType.TREATMENT,
          message: `Logged treatment ${medicine.name} for ${lot.owner.name} in ${lot.pen.name}.`,
          metadata: {
            lotId: lot.id,
            ownerName: lot.owner.name,
            penName: lot.pen.name,
            medicineId: medicine.id,
            medicine: medicine.name,
            headTreated,
            dosePerHead,
            totalUnitsUsed,
            billableAmount,
            billingMode: medicine.billingMode,
            date: date.toISOString(),
            notes,
          },
          createdByUserId: userId,
        },
        tx,
      )
    })

    revalidatePath("/dashboard/stocker/treatments")
    revalidatePath("/dashboard/stocker")
  }

  async function deleteTreatment(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER, ROLE_WORKER],
    })

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
      <PageHeader
        title="Treatments"
        subtitle="Log medicine usage by lot with automatic usage totals, billable cost, and historical pricing snapshots."
        badge="Stocker"
      />
      <StatusRow organizationName={core.organization.name} roleLabel={getRoleDisplayName(core.role)} />
      <ActionBar
        primaryAction={{ href: "#log-treatment", label: "+ Log Treatment" }}
        secondaryActions={core.role === ROLE_WORKER ? [] : [{ href: "/dashboard/stocker/medicine", label: "Medicine Library" }]}
      />

      <CardSection id="log-treatment" title="Log Treatment">
        {lots.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>Create a lot before logging treatments.</div>
        ) : medicines.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No active medicines available.</strong>
            {core.role === ROLE_WORKER
              ? "Ask an owner or manager to add medicines before logging treatments."
              : "Create a medicine in the library before logging treatments."}
          </div>
        ) : (
          <TreatmentEntryForm
            action={createTreatment}
            lots={lots.map((lot) => ({
              id: lot.id,
              arrivalDate: lot.arrivalDate,
              headCount: lot.headCount,
              ownerName: lot.owner.name,
              penName: lot.pen.name,
            }))}
            medicines={medicines}
            defaultDate={toDateInputValue(new Date())}
          />
        )}
      </CardSection>

      <CardSection title="Treatment Log">
        {treatments.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No treatments logged.</strong>
            Log your first treatment to begin recording medicine usage.
          </div>
        ) : (
          <div style={stackStyle}>
            {treatments.map((treatment) => {
              const unitLabel = treatment.medicineRecord?.unitLabel ?? "cc"
              const billingMode = treatment.billingModeSnapshot ?? MedicineBillingMode.PASS_THROUGH

              return (
                <article key={treatment.id} className="stocker-card" style={cardStyle}>
                  <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>{treatment.medicine}</div>
                  <div style={{ fontSize: 14, marginTop: 6 }}>
                    {formatLotLabel({
                      ownerName: treatment.lot.owner.name,
                      penName: treatment.lot.pen.name,
                      arrivalDate: treatment.lot.arrivalDate,
                    })}
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>
                    Dose: {treatment.dosePerHead} {unitLabel} per head | Date: {treatment.date.toLocaleDateString()}
                  </div>
                  {treatment.headTreated !== null ? (
                    <div style={{ ...metaTextStyle, marginTop: 6 }}>
                      Head treated: {treatment.headTreated} | Total {unitLabel} used: {treatment.totalUnitsUsed?.toFixed(2) ?? "—"}
                    </div>
                  ) : (
                    <div style={{ ...metaTextStyle, marginTop: 6 }}>
                      Legacy treatment record without head treated or pricing snapshot fields.
                    </div>
                  )}
                  {treatment.billableAmount !== null ? (
                    <div style={{ ...metaTextStyle, marginTop: 6 }}>
                      Billable amount: {formatMoney(treatment.billableAmount)} | Billing mode: {getMedicineBillingModeLabel(billingMode)}
                      {" "} | Cost snapshot: {formatMoney(treatment.costPerUnitSnapshot)}
                    </div>
                  ) : null}
                  {treatment.notes ? <p style={{ marginBottom: 0 }}>{treatment.notes}</p> : null}
                  <form action={deleteTreatment} style={{ marginTop: 12 }}>
                    <input type="hidden" name="treatmentId" value={treatment.id} />
                    <Button type="submit" variant="secondary">
                      Delete
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
