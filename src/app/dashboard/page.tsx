import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { ModuleKey } from "@prisma/client"
import { ensureCore } from "@/lib/ensure-core"
import { isModuleEnabledForOrganization } from "@/lib/module-entitlements"

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

  redirect(stockerEnabled ? "/dashboard/stocker" : "/dashboard/settings/modules")
}
