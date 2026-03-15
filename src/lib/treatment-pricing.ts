import { MedicineBillingMode } from "@prisma/client"

type TreatmentPricingInput = {
  headTreated: number
  dosePerHead: number
  costPerUnit: number
  billingMode: MedicineBillingMode
  chargePerUnit?: number | null
}

export function calculateTotalUnitsUsed(headTreated: number, dosePerHead: number) {
  return headTreated * dosePerHead
}

export function calculateBillableAmount({
  headTreated,
  dosePerHead,
  costPerUnit,
  billingMode,
  chargePerUnit,
}: TreatmentPricingInput) {
  const totalUnitsUsed = calculateTotalUnitsUsed(headTreated, dosePerHead)

  if (billingMode === MedicineBillingMode.FIXED_CHARGE) {
    return totalUnitsUsed * (chargePerUnit ?? 0)
  }

  return totalUnitsUsed * costPerUnit
}

export function getMedicineBillingModeLabel(mode: MedicineBillingMode) {
  switch (mode) {
    case MedicineBillingMode.FIXED_CHARGE:
      return "Fixed charge"
    case MedicineBillingMode.PASS_THROUGH_WITH_MARKUP:
      return "Pass through with markup"
    case MedicineBillingMode.PASS_THROUGH:
    default:
      return "Pass through"
  }
}

export function formatMoney(value: number | null | undefined) {
  return `$${(value ?? 0).toFixed(2)}`
}
