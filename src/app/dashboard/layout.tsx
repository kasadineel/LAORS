import Link from "next/link"
import { auth, currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { ModuleKey } from "@prisma/client"
import { ensureCore } from "@/lib/ensure-core"
import { isModuleEnabledForOrganization } from "@/lib/module-entitlements"

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
          <div style={{ fontSize: 12, opacity: 0.7 }}>{core.organization.name}</div>
        </div>

        <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {stockerEnabled ? <Link href="/dashboard/stocker">Stocker</Link> : null}
          <Link href="/dashboard/settings/modules">Settings</Link>
        </nav>
      </header>

      {children}
    </div>
  )
}
