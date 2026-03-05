import { currentUser } from "@clerk/nextjs/server"
import { ModuleKey } from "@prisma/client"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import Link from "next/link"
import { ensureCore } from "@/lib/ensure-core"
import { prisma } from "@/lib/prisma"

export default async function ModulesSettingsPage() {
  const user = await currentUser()
  if (!user) redirect("/sign-in")

  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })

  const orgId = core.activeOrganizationId
  const stockerModule = await prisma.organizationModule.findUnique({
    where: {
      organizationId_module: {
        organizationId: orgId,
        module: ModuleKey.STOCKER,
      },
    },
    select: { enabled: true },
  })

  async function updateStockerModule(formData: FormData) {
    "use server"

    const enabled = formData.get("enabled") === "on"

    await prisma.organizationModule.upsert({
      where: {
        organizationId_module: {
          organizationId: orgId,
          module: ModuleKey.STOCKER,
        },
      },
      update: { enabled },
      create: {
        organizationId: orgId,
        module: ModuleKey.STOCKER,
        enabled,
      },
    })

    revalidatePath("/dashboard")
    revalidatePath("/dashboard/settings/modules")
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/dashboard">Back to Dashboard</Link>
      </div>
      <h1>Module Settings</h1>
      <p style={{ marginTop: 8 }}>Enable or disable modules for the current organization.</p>

      <form
        action={updateStockerModule}
        style={{
          marginTop: 24,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          display: "grid",
          gap: 12,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={stockerModule?.enabled === true}
          />
          <span>
            <strong>Stocker</strong>
            <span style={{ display: "block", fontSize: 12, opacity: 0.7 }}>
              Enables animal pages and Stocker workflows.
            </span>
          </span>
        </label>

        <div>
          <button type="submit" style={{ padding: "8px 12px" }}>
            Save Modules
          </button>
        </div>
      </form>
    </main>
  )
}
