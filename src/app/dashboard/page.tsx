import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { ModuleKey } from "@prisma/client"
import { ensureCore } from "@/lib/ensure-core"
import { isModuleEnabledForOrganization } from "@/lib/module-entitlements"
import { canManageModules } from "@/lib/permissions"

export default async function DashboardPage() {
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

  if (stockerEnabled) {
    redirect("/dashboard/stocker")
  }

  if (canManageModules(core.membership.role)) {
    redirect("/dashboard/settings/modules")
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <p>No enabled modules are available for your role in this organization.</p>
    </main>
  )
}
