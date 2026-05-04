import { revalidatePath } from "next/cache"
import { MedicineBillingMode, ModuleKey } from "@prisma/client"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { getMedicineDelegate, prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { parseNumberInput, requireStockerAccess } from "@/lib/stocker"
import { formatMoney, getMedicineBillingModeLabel } from "@/lib/treatment-pricing"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  metaTextStyle,
  pageStyle,
  stackStyle,
} from "@/lib/stocker-ui"

export default async function MedicinePage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId
  const userId = core.user.id
  const medicineDelegate = getMedicineDelegate()

  const medicines = await medicineDelegate.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      unitLabel: true,
      costPerUnit: true,
      billingMode: true,
      chargePerUnit: true,
      isActive: true,
      notes: true,
    },
  })

  async function createMedicine(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const name = formData.get("name")?.toString().trim()
    const unitLabel = formData.get("unitLabel")?.toString().trim() || "cc"
    const costPerUnit = parseNumberInput(formData.get("costPerUnit"))
    const billingModeRaw = formData.get("billingMode")?.toString()
    const notes = formData.get("notes")?.toString().trim() || null
    const chargePerUnit = parseNumberInput(formData.get("chargePerUnit"))

    const billingMode = billingModeRaw && billingModeRaw in MedicineBillingMode
      ? MedicineBillingMode[billingModeRaw as keyof typeof MedicineBillingMode]
      : MedicineBillingMode.PASS_THROUGH

    if (!name || costPerUnit === null) return
    if (billingMode === MedicineBillingMode.FIXED_CHARGE && chargePerUnit === null) return

    await prisma.medicine.create({
      data: {
        organizationId: orgId,
        name,
        unitLabel,
        costPerUnit,
        billingMode,
        chargePerUnit: billingMode === MedicineBillingMode.FIXED_CHARGE ? chargePerUnit : null,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/medicine")
    revalidatePath("/dashboard/stocker/treatments")
  }

  async function updateMedicine(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const medicineId = formData.get("medicineId")?.toString()
    const name = formData.get("name")?.toString().trim()
    const unitLabel = formData.get("unitLabel")?.toString().trim() || "cc"
    const costPerUnit = parseNumberInput(formData.get("costPerUnit"))
    const billingModeRaw = formData.get("billingMode")?.toString()
    const chargePerUnit = parseNumberInput(formData.get("chargePerUnit"))
    const notes = formData.get("notes")?.toString().trim() || null

    const billingMode = billingModeRaw && billingModeRaw in MedicineBillingMode
      ? MedicineBillingMode[billingModeRaw as keyof typeof MedicineBillingMode]
      : MedicineBillingMode.PASS_THROUGH

    if (!medicineId || !name || costPerUnit === null) return
    if (billingMode === MedicineBillingMode.FIXED_CHARGE && chargePerUnit === null) return

    await prisma.medicine.updateMany({
      where: { id: medicineId, organizationId: orgId },
      data: {
        name,
        unitLabel,
        costPerUnit,
        billingMode,
        chargePerUnit: billingMode === MedicineBillingMode.FIXED_CHARGE ? chargePerUnit : null,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/medicine")
    revalidatePath("/dashboard/stocker/treatments")
  }

  async function toggleMedicineActive(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const medicineId = formData.get("medicineId")?.toString()
    const nextValue = formData.get("nextValue")?.toString() === "true"
    if (!medicineId) return

    await prisma.medicine.updateMany({
      where: { id: medicineId, organizationId: orgId },
      data: { isActive: nextValue },
    })

    revalidatePath("/dashboard/stocker/medicine")
    revalidatePath("/dashboard/stocker/treatments")
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Medicine Library"
        subtitle="Review active medicines and billing behavior first. Open setup only when you need to maintain pricing or product details."
        badge="Stocker"
      />
      <StatusRow organizationName={core.organization.name} roleLabel={getRoleDisplayName(core.role)} />
      <ActionBar
        primaryAction={{ href: "/dashboard/stocker/treatments", label: "Treat Cattle" }}
        secondaryActions={[
          { href: "#medicine-library", label: "Medicine Library" },
          { href: "#medicine-setup", label: "Medicine Setup" },
        ]}
      />

      <CardSection title="Medicine Priorities">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {[
            { label: "Active Medicines", value: `${medicines.filter((medicine) => medicine.isActive).length}`, note: "Products currently ready for treatment entry." },
            { label: "Inactive Medicines", value: `${medicines.filter((medicine) => !medicine.isActive).length}`, note: "Older or paused products kept for history." },
            { label: "Fixed Charges", value: `${medicines.filter((medicine) => medicine.billingMode === MedicineBillingMode.FIXED_CHARGE).length}`, note: "Products billing off a fixed unit charge." },
          ].map((item) => (
            <article key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>{item.value}</div>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>{item.note}</p>
            </article>
          ))}
        </div>
      </CardSection>

      <CardSection id="medicine-library" title="Medicine Library">
        <p style={{ ...metaTextStyle, marginTop: 0, marginBottom: 16, lineHeight: 1.7 }}>
          This list is the active treatment reference. Use it to confirm what is available and how each product will bill before logging treatment.
        </p>
        {medicines.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No medicines yet.</strong>
            Add your first medicine to enable dropdown-based treatment entry and billing snapshots.
          </div>
        ) : (
          <div style={stackStyle}>
            {medicines.map((medicine) => (
              <details key={medicine.id} className="stocker-disclosure">
                <summary>{medicine.name}</summary>
                <div className="stocker-disclosure__body">
                <article className="stocker-card" style={cardStyle}>
                <form action={updateMedicine} style={stackStyle}>
                  <input type="hidden" name="medicineId" value={medicine.id} />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <strong style={{ color: "var(--stocker-navy)" }}>{medicine.name}</strong>
                      <div style={metaTextStyle}>
                        {medicine.isActive ? "Active" : "Inactive"} | {getMedicineBillingModeLabel(medicine.billingMode)}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--stocker-primary)" }}>
                      {formatMoney(medicine.costPerUnit)} / {medicine.unitLabel}
                    </div>
                  </div>

                  <div style={gridStyle}>
                    <Input label="Medicine Name" name="name" defaultValue={medicine.name} style={inputStyle} />
                    <Input label="Unit Label" name="unitLabel" defaultValue={medicine.unitLabel} style={inputStyle} />
                    <Input
                      label="Cost per Unit"
                      name="costPerUnit"
                      defaultValue={medicine.costPerUnit}
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.0001"
                      style={inputStyle}
                    />
                    <Select label="Billing Mode" name="billingMode" defaultValue={medicine.billingMode} style={inputStyle}>
                      <option value={MedicineBillingMode.PASS_THROUGH}>Pass through</option>
                      <option value={MedicineBillingMode.PASS_THROUGH_WITH_MARKUP}>Pass through with markup</option>
                      <option value={MedicineBillingMode.FIXED_CHARGE}>Fixed charge</option>
                    </Select>
                    <Input
                      label="Charge per Unit"
                      name="chargePerUnit"
                      defaultValue={medicine.chargePerUnit ?? ""}
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.0001"
                      style={inputStyle}
                    />
                  </div>

                  <Textarea
                    label="Notes"
                    name="notes"
                    rows={2}
                    defaultValue={medicine.notes ?? ""}
                    placeholder="Notes (optional)"
                    style={inputStyle}
                  />

                  <div style={{ ...metaTextStyle, marginTop: 4 }}>
                    Billable rate:{" "}
                    {medicine.billingMode === MedicineBillingMode.FIXED_CHARGE
                      ? `${formatMoney(medicine.chargePerUnit)} / ${medicine.unitLabel}`
                      : `${formatMoney(medicine.costPerUnit)} / ${medicine.unitLabel}`}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button type="submit" variant="primary">
                      Update
                    </Button>
                  </div>
                </form>

                <form action={toggleMedicineActive} style={{ marginTop: 10 }}>
                  <input type="hidden" name="medicineId" value={medicine.id} />
                  <input type="hidden" name="nextValue" value={medicine.isActive ? "false" : "true"} />
                  <Button type="submit" variant="secondary">
                    {medicine.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </form>
              </article>
              </div>
              </details>
            ))}
          </div>
        )}
      </CardSection>

      <CardSection id="medicine-setup" title="Medicine Setup">
        <details className="stocker-disclosure">
          <summary>Open medicine creation</summary>
          <div className="stocker-disclosure__body">
            <form action={createMedicine} style={stackStyle}>
              <div style={gridStyle}>
                <Input label="Medicine Name" name="name" placeholder="Draxxin" required style={inputStyle} />
                <Input label="Unit Label" name="unitLabel" placeholder="cc" defaultValue="cc" style={inputStyle} />
                <Input
                  label="Cost per Unit"
                  name="costPerUnit"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="0.0001"
                  required
                  style={inputStyle}
                />
                <Select label="Billing Mode" name="billingMode" defaultValue={MedicineBillingMode.PASS_THROUGH} style={inputStyle}>
                  <option value={MedicineBillingMode.PASS_THROUGH}>Pass through</option>
                  <option value={MedicineBillingMode.PASS_THROUGH_WITH_MARKUP}>Pass through with markup</option>
                  <option value={MedicineBillingMode.FIXED_CHARGE}>Fixed charge</option>
                </Select>
                <Input
                  label="Charge per Unit"
                  name="chargePerUnit"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="0.0001"
                  style={inputStyle}
                />
              </div>
              <Textarea label="Notes" name="notes" rows={3} placeholder="Notes (optional)" style={inputStyle} />
              <div>
                <Button type="submit" variant="primary">
                  Save Medicine
                </Button>
              </div>
            </form>
          </div>
        </details>
      </CardSection>
    </main>
  )
}
