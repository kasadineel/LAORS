import { currentUser } from "@clerk/nextjs/server"
import { ModuleKey } from "@prisma/client"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { ensureCore } from "@/lib/ensure-core"
import { requireRole, ROLE_OWNER } from "@/lib/permissions"
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
  await requireRole({
    userId: core.user.id,
    organizationId: orgId,
    allowedRoles: [ROLE_OWNER],
  })
  const stockerModule = await prisma.organizationModule.findUnique({
    where: {
      organizationId_module: {
        organizationId: orgId,
        module: ModuleKey.STOCKER,
      },
    },
    select: { enabled: true },
  })

  async function updateOrganizationDetails(formData: FormData) {
    "use server"

    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER],
    })

    const name = formData.get("organizationName")?.toString().trim()
    if (!name) return

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        name,
      },
    })

    revalidatePath("/dashboard")
    revalidatePath("/dashboard/stocker")
    revalidatePath("/dashboard/settings/modules")
    revalidatePath("/dashboard/stocker/invoices")
  }

  async function updateStockerModule(formData: FormData) {
    "use server"

    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER],
    })

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
    <main style={{ padding: 24, maxWidth: 820, display: "grid", gap: 20 }}>
      <div style={{ marginBottom: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button href="/dashboard" variant="ghost" size="sm">
          Back to Dashboard
        </Button>
        <Button href="/dashboard/stocker" variant="secondary" size="sm">
          Back to Stocker
        </Button>
      </div>
      <div>
        <h1 style={{ margin: 0, color: "var(--ink)" }}>Organization Settings</h1>
        <p style={{ marginTop: 8, color: "var(--muted)", lineHeight: 1.7 }}>
          Set the operation name used across Stocker and control which modules are enabled for this organization.
        </p>
      </div>

      <form
        action={updateOrganizationDetails}
        className="stocker-card"
        style={{
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>Operation Identity</div>
          <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
            This name appears in dashboard headers, invoice print views, and Stocker status chips.
          </div>
        </div>
        <Input
          label="Operation Name"
          name="organizationName"
          defaultValue={core.organization.name}
          required
        />
        <div>
          <Button type="submit" variant="primary">
            Save Operation Name
          </Button>
        </div>
      </form>

      <form
        action={updateStockerModule}
        className="stocker-card"
        style={{
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>Modules</div>
          <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
            Enable or disable the Stocker module for the current operation.
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={stockerModule?.enabled === true}
          />
          <span>
            <strong>Stocker</strong>
            <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
              Enables lot, treatment, feed, billing, and invoice workflows.
            </span>
          </span>
        </label>

        <div>
          <Button type="submit" variant="primary">
            Save Modules
          </Button>
        </div>
      </form>
    </main>
  )
}
