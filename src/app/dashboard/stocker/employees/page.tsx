import { clerkClient } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Card } from "@/components/stocker/ui/Card"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Table } from "@/components/stocker/ui/Table"
import { MembershipRole, ModuleKey } from "@prisma/client"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import {
  canManageEmployees,
  getRoleDisplayName,
  requireRole,
  type RoleValue,
  ROLE_MANAGER,
  ROLE_OWNER,
} from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { requireStockerAccess } from "@/lib/stocker"
import { formatStockerActivityMessage } from "@/lib/stocker-labels"
import {
  cardStyle,
  emptyStateStyle,
  inputStyle,
  metaTextStyle,
  pageStyle,
  stackStyle,
  tableContainerStyle,
} from "@/lib/stocker-ui"

const ROLE_OPTIONS = [
  { value: MembershipRole.OWNER, label: "Owner" },
  { value: MembershipRole.MANAGER, label: "Manager" },
  { value: MembershipRole.WORKER, label: "Employee" },
] as const

function normalizeEmail(value: FormDataEntryValue | null) {
  return value?.toString().trim().toLowerCase() ?? ""
}

function canAssignRole(actorRole: RoleValue, nextRole: MembershipRole) {
  if (actorRole === ROLE_OWNER) return true
  if (actorRole === ROLE_MANAGER) {
    return nextRole === MembershipRole.MANAGER || nextRole === MembershipRole.WORKER
  }

  return false
}

function canManageTarget({
  actorRole,
  targetRole,
}: {
  actorRole: RoleValue
  targetRole: MembershipRole
}) {
  if (actorRole === ROLE_OWNER) return true
  if (actorRole === ROLE_MANAGER) return targetRole !== MembershipRole.OWNER
  return false
}

export default async function EmployeesPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId

  const memberships = await prisma.membership.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          clerkUserId: true,
        },
      },
    },
  })

  const recentActivities = await prisma.stockerActivity.findMany({
    where: {
      organizationId: orgId,
      createdByUserId: {
        in: memberships.map((membership) => membership.userId),
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      createdByUserId: true,
      createdAt: true,
      type: true,
      message: true,
      metadata: true,
    },
  })

  const activityByUserId = new Map<string, (typeof recentActivities)[number]>()
  for (const activity of recentActivities) {
    if (!activity.createdByUserId || activityByUserId.has(activity.createdByUserId)) continue
    activityByUserId.set(activity.createdByUserId, activity)
  }

  async function inviteEmployee(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    const actorRole = await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const email = normalizeEmail(formData.get("email"))
    const roleValue = formData.get("role")?.toString() as MembershipRole | undefined
    const role = roleValue && Object.values(MembershipRole).includes(roleValue) ? roleValue : MembershipRole.WORKER

    if (!email || !canAssignRole(actorRole, role)) return

    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({
        data: {
          email,
          clerkUserId: `pending:${email}`,
          name: null,
        },
      }))

    await prisma.membership.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: orgId,
        },
      },
      update: {
        role,
      },
      create: {
        userId: user.id,
        organizationId: orgId,
        role,
      },
    })

    const client = await clerkClient()
    try {
      await client.invitations.createInvitation({
        emailAddress: email,
        ignoreExisting: true,
        notify: true,
        redirectUrl: `${process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up"}`,
      })
    } catch {
      // Membership is already created locally; keep the access record even if email delivery fails.
    }

    revalidatePath("/dashboard/stocker/employees")
  }

  async function updateEmployeeRole(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    const actorRole = await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const membershipId = formData.get("membershipId")?.toString()
    const nextRoleValue = formData.get("role")?.toString() as MembershipRole | undefined
    const nextRole =
      nextRoleValue && Object.values(MembershipRole).includes(nextRoleValue) ? nextRoleValue : null

    if (!membershipId || !nextRole || !canAssignRole(actorRole, nextRole)) return

    const target = await prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId },
      select: { id: true, role: true },
    })

    if (!target || !canManageTarget({ actorRole, targetRole: target.role })) return

    await prisma.membership.update({
      where: { id: target.id },
      data: { role: nextRole },
    })

    revalidatePath("/dashboard/stocker/employees")
    revalidatePath("/dashboard/stocker")
  }

  const canEditEmployees = canManageEmployees(core.role)
  const assignableRoles =
    core.role === ROLE_OWNER
      ? ROLE_OPTIONS
      : ROLE_OPTIONS.filter((option) => option.value !== MembershipRole.OWNER)

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Employees"
        subtitle="Manage who can access the yard system, what role they hold, and whether their access is active."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
      />
      <ActionBar primaryAction={{ href: "#invite-employee", label: "Invite Employee" }} />

      <CardSection id="invite-employee" title="Invite Employee">
        <form action={inviteEmployee} style={{ ...stackStyle, maxWidth: 720 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Input label="Email" name="email" type="email" placeholder="operator@ranch.com" required style={inputStyle} />
            <Select label="Role" name="role" defaultValue={MembershipRole.WORKER} style={inputStyle}>
              {assignableRoles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </Select>
          </div>
          <div style={metaTextStyle}>
            Adding an employee creates organization access immediately and sends a sign-up invitation when Clerk email delivery is available.
          </div>
          <div>
            <Button type="submit" variant="primary">
              Invite Employee
            </Button>
          </div>
        </form>
      </CardSection>

      <CardSection title="Employee Directory">
        {memberships.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No employees are associated with this operation yet.
          </div>
        ) : (
          <>
            <div className="stocker-mobile-cards">
              {memberships.map((membership) => {
                const activity = activityByUserId.get(membership.userId)
                const isPending = membership.user.clerkUserId.startsWith("pending:")

                return (
                  <Card key={membership.id} style={cardStyle}>
                    <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                      {membership.user.name || membership.user.email}
                    </div>
                    <div style={{ ...metaTextStyle, marginTop: 6 }}>{membership.user.email}</div>
                    <div style={{ ...metaTextStyle, marginTop: 8 }}>Role: {getRoleDisplayName(membership.role)}</div>
                    <div style={{ ...metaTextStyle, marginTop: 6 }}>Status: Active</div>
                    <div style={{ ...metaTextStyle, marginTop: 6 }}>
                      Last Activity: {activity ? formatStockerActivityMessage(activity) : isPending ? "Pending sign-in" : "Not available"}
                    </div>
                    <div style={{ ...metaTextStyle, marginTop: 12 }}>
                      Access removal is not available in this schema version.
                    </div>
                  </Card>
                )
              })}
            </div>

            <Card className="stocker-desktop-table" style={tableContainerStyle}>
              <Table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last Activity</th>
                    <th data-align="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((membership) => {
                    const activity = activityByUserId.get(membership.userId)
                    const isPending = membership.user.clerkUserId.startsWith("pending:")
                    const canEditTarget =
                      canEditEmployees &&
                      membership.userId !== core.user.id &&
                      canManageTarget({ actorRole: core.role, targetRole: membership.role })

                    return (
                      <tr key={membership.id}>
                        <td style={{ fontWeight: 700 }}>{membership.user.name || "Pending user"}</td>
                        <td>{membership.user.email}</td>
                        <td>
                          {canEditTarget ? (
                            <form action={updateEmployeeRole} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                              <input type="hidden" name="membershipId" value={membership.id} />
                              <Select
                                label="Role"
                                name="role"
                                defaultValue={membership.role}
                                style={{ ...inputStyle, minHeight: 38, padding: "8px 10px", minWidth: 150 }}
                              >
                                {assignableRoles
                                  .filter((role) => core.role === ROLE_OWNER || role.value !== MembershipRole.OWNER)
                                  .map((role) => (
                                    <option key={role.value} value={role.value}>
                                      {role.label}
                                    </option>
                                  ))}
                              </Select>
                              <Button type="submit" variant="secondary" size="sm">
                                Save
                              </Button>
                            </form>
                          ) : (
                            getRoleDisplayName(membership.role)
                          )}
                        </td>
                        <td>Active</td>
                        <td>
                          {activity ? (
                            <div style={{ display: "grid", gap: 4 }}>
                              <span>{formatStockerActivityMessage(activity)}</span>
                              <span style={metaTextStyle}>{activity.createdAt.toLocaleString()}</span>
                            </div>
                          ) : (
                            <span style={metaTextStyle}>{isPending ? "Pending sign-in" : "Not available"}</span>
                          )}
                        </td>
                        <td data-align="right">
                          <span style={metaTextStyle}>
                            {canEditTarget ? "Role only" : "No action"}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </Card>
          </>
        )}
      </CardSection>
    </main>
  )
}
