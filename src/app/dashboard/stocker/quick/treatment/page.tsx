import Link from "next/link"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { ModuleKey, StockerActivityType } from "@prisma/client"
import { TreatmentEntryForm } from "@/components/stocker/treatment-entry-form"
import { logStockerActivity } from "@/lib/stocker-activity"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireRole, ROLE_MANAGER, ROLE_OWNER, ROLE_WORKER } from "@/lib/permissions"
import { getMedicineDelegate, prisma } from "@/lib/prisma"
import {
  appendStockerSavedParam,
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  sanitizeReturnTo,
  toDateInputValue,
} from "@/lib/stocker"
import { calculateBillableAmount, calculateTotalUnitsUsed } from "@/lib/treatment-pricing"
import {
  cardStyle,
  emptyStateStyle,
  pageHeaderStyle,
  pageStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  sectionCardStyle,
} from "@/lib/stocker-ui"

type QuickTreatmentPageProps = {
  searchParams?: Promise<{ returnTo?: string | string[] }> | { returnTo?: string | string[] }
}

export default async function QuickTreatmentPage({ searchParams }: QuickTreatmentPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER, ROLE_WORKER])
  const userId = core.user.id
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const returnToParam = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo
  const returnTo = sanitizeReturnTo(returnToParam)
  const orgId = core.activeOrganizationId
  const medicineDelegate = getMedicineDelegate()

  const [lots, medicines] = await Promise.all([
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
  ])

  async function createQuickTreatment(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER, ROLE_WORKER],
    })

    const targetReturnTo = sanitizeReturnTo(formData.get("returnTo")?.toString())
    const lotId = formData.get("lotId")?.toString()
    const medicineId = formData.get("medicineId")?.toString()
    const headTreatedValue = parseNumberInput(formData.get("headTreated"))
    const dosePerHead = parseNumberInput(formData.get("dosePerHead"))
    const date = parseDateInput(formData.get("date"), new Date())
    const notes = formData.get("notes")?.toString().trim() || null
    const intent = formData.get("intent")?.toString()

    if (!lotId || !medicineId || headTreatedValue === null || dosePerHead === null || !date) return

    const headTreated = Math.trunc(headTreatedValue)
    if (headTreated < 1) return

    const [lot, medicine] = await Promise.all([
      prisma.lot.findFirst({
        where: { id: lotId, organizationId: orgId },
        select: {
          id: true,
          headCount: true,
          arrivalDate: true,
          owner: { select: { name: true } },
          pen: { select: { name: true } },
        },
      }),
      prisma.medicine.findFirst({
        where: { id: medicineId, organizationId: orgId, isActive: true },
        select: {
          id: true,
          name: true,
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

    if (intent === "add-another") {
      redirect(`/dashboard/stocker/quick/treatment?returnTo=${encodeURIComponent(targetReturnTo)}`)
    }

    redirect(appendStockerSavedParam(targetReturnTo, "treatment"))
  }

  return (
    <main style={pageStyle}>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>Quick Treatment</h1>
          <p style={pageSubtitleStyle}>Log treatment from a single compact form designed for repeated use.</p>
        </div>
        <Link className="stocker-link" href={returnTo} style={{ alignSelf: "center", fontWeight: 700 }}>
          Back
        </Link>
      </div>

      <section className="stocker-section" style={{ ...sectionCardStyle, maxWidth: 820 }}>
        {lots.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Create a lot before using quick treatment logging.
          </div>
        ) : medicines.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            {core.role === ROLE_WORKER
              ? "Ask an owner or manager to add an active medicine before using quick treatment."
              : "Add an active medicine to the library before using quick treatment."}
          </div>
        ) : (
          <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
            <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
              <strong style={{ color: "var(--stocker-navy)" }}>Fast treatment entry</strong>
              <p style={{ margin: 0, color: "var(--stocker-muted)" }}>
                Use this when you need lot, medicine, head treated, dose, date, and automatic billable cost in one step.
              </p>
            </div>
            <TreatmentEntryForm
              action={createQuickTreatment}
              lots={lots.map((lot) => ({
                id: lot.id,
                arrivalDate: lot.arrivalDate,
                headCount: lot.headCount,
                ownerName: lot.owner.name,
                penName: lot.pen.name,
              }))}
              medicines={medicines}
              defaultDate={toDateInputValue(new Date())}
              returnTo={returnTo}
              showAddAnother
            />
          </div>
        )}
      </section>
    </main>
  )
}
