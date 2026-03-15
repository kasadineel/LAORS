"use client"

import { useState } from "react"
import { QuickSubmitButton } from "@/components/stocker/quick-submit-button"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { formatLotOptionLabel } from "@/lib/stocker-labels"
import { getMedicineBillingModeLabel, calculateBillableAmount, calculateTotalUnitsUsed, formatMoney } from "@/lib/treatment-pricing"
import { MedicineBillingMode } from "@prisma/client"

type TreatmentLotOption = {
  id: string
  arrivalDate?: Date | string
  headCount: number
  ownerName: string
  penName: string
}

type TreatmentMedicineOption = {
  id: string
  name: string
  unitLabel: string
  costPerUnit: number
  billingMode: MedicineBillingMode
  chargePerUnit: number | null
}

type TreatmentEntryFormProps = {
  action: (formData: FormData) => void | Promise<void>
  lots: TreatmentLotOption[]
  medicines: TreatmentMedicineOption[]
  defaultDate: string
  returnTo?: string
  showAddAnother?: boolean
}

export function TreatmentEntryForm({
  action,
  lots,
  medicines,
  defaultDate,
  returnTo,
  showAddAnother = false,
}: TreatmentEntryFormProps) {
  const [medicineId, setMedicineId] = useState("")
  const [headTreated, setHeadTreated] = useState("")
  const [dosePerHead, setDosePerHead] = useState("")

  const selectedMedicine = medicines.find((medicine) => medicine.id === medicineId) ?? null
  const parsedHeadTreated = Number(headTreated)
  const parsedDosePerHead = Number(dosePerHead)
  const hasPreviewValues =
    selectedMedicine !== null &&
    Number.isFinite(parsedHeadTreated) &&
    parsedHeadTreated > 0 &&
    Number.isFinite(parsedDosePerHead) &&
    parsedDosePerHead > 0

  const unitLabel = selectedMedicine?.unitLabel || "cc"
  const totalUnitsUsed = hasPreviewValues
    ? calculateTotalUnitsUsed(parsedHeadTreated, parsedDosePerHead)
    : null
  const estimatedBillableAmount = hasPreviewValues && selectedMedicine
    ? calculateBillableAmount({
        headTreated: parsedHeadTreated,
        dosePerHead: parsedDosePerHead,
        costPerUnit: selectedMedicine.costPerUnit,
        billingMode: selectedMedicine.billingMode,
        chargePerUnit: selectedMedicine.chargePerUnit,
      })
    : null

  return (
    <form action={action} className="stocker-form-stack" style={{ display: "grid", gap: 16 }}>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Select
          label="Lot"
          name="lotId"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Select lot
          </option>
          {lots.map((lot) => (
            <option key={lot.id} value={lot.id}>
              {formatLotOptionLabel(lot)}
            </option>
          ))}
        </Select>

        <Select
          label="Medicine"
          name="medicineId"
          defaultValue=""
          required
          onChange={(event) => setMedicineId(event.target.value)}
        >
          <option value="" disabled>
            Select medicine
          </option>
          {medicines.map((medicine) => (
            <option key={medicine.id} value={medicine.id}>
              {medicine.name}
            </option>
          ))}
        </Select>

        <Input
          label="Head treated"
          name="headTreated"
          inputMode="numeric"
          type="number"
          min="1"
          step="1"
          required
          value={headTreated}
          onChange={(event) => setHeadTreated(event.target.value)}
        />

        <Input
          label={`Dose per head (${unitLabel})`}
          name="dosePerHead"
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          required
          value={dosePerHead}
          onChange={(event) => setDosePerHead(event.target.value)}
        />

        <Input
          label="Treatment date"
          type="date"
          name="date"
          defaultValue={defaultDate}
          required
        />
      </div>

      <Textarea label="Notes" name="notes" rows={3} placeholder="Notes (optional)" />

      {selectedMedicine ? (
        <div className="stocker-card" style={{ padding: 16 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <strong style={{ color: "var(--stocker-navy)" }}>{selectedMedicine.name}</strong>
            <div style={{ color: "var(--stocker-muted)", fontSize: 14 }}>
              Cost per {unitLabel}: {formatMoney(selectedMedicine.costPerUnit)}
            </div>
            <div style={{ color: "var(--stocker-muted)", fontSize: 14 }}>
              Billing mode: {getMedicineBillingModeLabel(selectedMedicine.billingMode)}
            </div>
            {selectedMedicine.billingMode === MedicineBillingMode.FIXED_CHARGE ? (
              <div style={{ color: "var(--stocker-muted)", fontSize: 14 }}>
                Charge per {unitLabel}: {formatMoney(selectedMedicine.chargePerUnit)}
              </div>
            ) : null}
            {hasPreviewValues ? (
              <div
                style={{
                  display: "grid",
                  gap: 6,
                  marginTop: 6,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: 14, color: "var(--ink)" }}>
                  Total {unitLabel} used: <strong>{totalUnitsUsed?.toFixed(2)}</strong>
                </div>
                <div style={{ fontSize: 14, color: "var(--ink)" }}>
                  Billable amount: <strong>{formatMoney(estimatedBillableAmount)}</strong>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <QuickSubmitButton>Save Treatment</QuickSubmitButton>
        {showAddAnother ? (
          <Button
            type="submit"
            name="intent"
            value="add-another"
            variant="secondary"
          >
            Save &amp; Add Another
          </Button>
        ) : null}
      </div>
    </form>
  )
}
