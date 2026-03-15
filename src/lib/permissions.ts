import { MembershipRole } from "@prisma/client"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"

export type RoleValue = MembershipRole | "OWNER" | "MANAGER" | "WORKER" | null

export const ROLE_OWNER = MembershipRole?.OWNER ?? "OWNER"
export const ROLE_MANAGER = MembershipRole?.MANAGER ?? "MANAGER"
export const ROLE_WORKER = MembershipRole?.WORKER ?? "WORKER"
export const ROLE_DISPLAY_NAMES = {
  OWNER: "Owner",
  MANAGER: "Manager",
  WORKER: "Employee",
} as const

type MembershipLookup = {
  userId: string
  organizationId: string
}

type RequireRoleInput = MembershipLookup & {
  allowedRoles: RoleValue[]
  redirectTo?: string
}

function normalizeRole(role: RoleValue) {
  const value = role === null ? null : String(role)

  if (value === ROLE_OWNER || value === "OWNER") return "OWNER"
  if (value === ROLE_MANAGER || value === "MANAGER") return "MANAGER"
  if (value === ROLE_WORKER || value === "WORKER") return "WORKER"
  return null
}

export async function getMembershipRole({ userId, organizationId }: MembershipLookup) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
    select: { role: true },
  })

  return membership?.role ?? null
}

export async function requireRole({
  userId,
  organizationId,
  allowedRoles,
  redirectTo = "/dashboard",
}: RequireRoleInput) {
  const role = await getMembershipRole({ userId, organizationId })
  const normalizedRole = normalizeRole(role)
  const normalizedAllowedRoles = allowedRoles.map(normalizeRole)

  if (!normalizedRole || !normalizedAllowedRoles.includes(normalizedRole)) {
    redirect(redirectTo)
  }

  return role
}

export function canManageStocker(role: RoleValue) {
  const normalizedRole = normalizeRole(role)
  return normalizedRole === "OWNER" || normalizedRole === "MANAGER"
}

export function canLogTreatments(role: RoleValue) {
  const normalizedRole = normalizeRole(role)
  return normalizedRole === "OWNER" || normalizedRole === "MANAGER" || normalizedRole === "WORKER"
}

export function canManageModules(role: RoleValue) {
  return normalizeRole(role) === "OWNER"
}

export function canManageEmployees(role: RoleValue) {
  const normalizedRole = normalizeRole(role)
  return normalizedRole === "OWNER" || normalizedRole === "MANAGER"
}

export function getRoleDisplayName(role: RoleValue) {
  const normalizedRole = normalizeRole(role)
  if (!normalizedRole) return "Employee"

  return ROLE_DISPLAY_NAMES[normalizedRole]
}
