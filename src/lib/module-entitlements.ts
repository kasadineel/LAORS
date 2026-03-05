import { ModuleKey } from "@prisma/client"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"

export async function isModuleEnabledForOrganization(
  organizationId: string,
  moduleKey: ModuleKey,
) {
  const entitlement = await prisma.organizationModule.findUnique({
    where: {
      organizationId_module: {
        organizationId,
        module: moduleKey,
      },
    },
    select: { enabled: true },
  })

  return entitlement?.enabled === true
}

export async function requireModuleForOrganization(
  organizationId: string,
  moduleKey: ModuleKey,
) {
  const enabled = await isModuleEnabledForOrganization(organizationId, moduleKey)

  if (!enabled) redirect("/dashboard")
}
