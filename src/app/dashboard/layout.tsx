import { auth, currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { ModuleKey } from "@prisma/client"
import { Button } from "@/components/stocker/ui/Button"
import { ensureCore } from "@/lib/ensure-core"
import { isModuleEnabledForOrganization } from "@/lib/module-entitlements"
import { canManageModules, getRoleDisplayName } from "@/lib/permissions"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const user = await currentUser()
  if (!user) redirect("/sign-in")

  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })

  const stockerEnabled = await isModuleEnabledForOrganization(
    core.activeOrganizationId,
    ModuleKey.STOCKER,
  )

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        className="dashboard-shell-header"
        style={{
          padding: 24,
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div>
          <strong>LAORS</strong>
          <div style={{ fontSize: 12, opacity: 0.7, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>{core.organization.name}</span>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "rgba(11, 45, 69, 0.08)",
                color: "#0B2D45",
                fontWeight: 600,
              }}
            >
              {getRoleDisplayName(core.membership.role)}
            </span>
          </div>
        </div>

        <nav className="stocker-ui-topnav dashboard-shell-nav">
          {stockerEnabled ? <Button href="/dashboard/stocker" variant="secondary" size="sm">Stocker</Button> : null}
          {canManageModules(core.membership.role) ? <Button href="/dashboard/settings/modules" variant="ghost" size="sm">Settings</Button> : null}
        </nav>
      </header>

      {children}
    </div>
  )
}
