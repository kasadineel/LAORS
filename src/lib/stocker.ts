import { currentUser } from "@clerk/nextjs/server"
import { ModuleKey } from "@prisma/client"
import { redirect } from "next/navigation"
import { ensureCore } from "@/lib/ensure-core"
import { requireModuleForOrganization } from "@/lib/module-entitlements"

const DAY_IN_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function toDateInputValue(date: Date | null | undefined) {
  if (!date) return ""

  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function parseDateInput(value: FormDataEntryValue | null, fallback?: Date) {
  const raw = value?.toString().trim()
  if (!raw) return fallback ?? null

  const parsed = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${raw}`)
  }

  return parsed
}

export function parseNumberInput(value: FormDataEntryValue | null, fallback?: number | null) {
  const raw = value?.toString().trim()
  if (!raw) return fallback ?? null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${raw}`)
  }

  return parsed
}

export function getMonthWindow(monthParam?: string) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}`
  const monthValue = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth
  const [year, month] = monthValue.split("-").map(Number)
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 1)

  return {
    monthValue,
    monthStart,
    monthEnd,
    label: monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  }
}

export function calculateHeadDaysForLot(
  arrivalDate: Date,
  exitDate: Date | null,
  headCount: number,
  monthStart: Date,
  monthEnd: Date,
) {
  const today = startOfDay(new Date())
  const arrival = startOfDay(arrivalDate)
  const finalDate = startOfDay(exitDate ?? today)
  const effectiveEndExclusive = new Date(finalDate.getTime() + DAY_IN_MS)
  const overlapStart = Math.max(arrival.getTime(), monthStart.getTime())
  const overlapEnd = Math.min(effectiveEndExclusive.getTime(), monthEnd.getTime())

  if (overlapEnd <= overlapStart) return 0

  const days = Math.ceil((overlapEnd - overlapStart) / DAY_IN_MS)
  return days * headCount
}

export async function requireStockerAccess() {
  const user = await currentUser()
  if (!user) redirect("/sign-in")

  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })

  await requireModuleForOrganization(core.activeOrganizationId, ModuleKey.STOCKER)

  return core
}
