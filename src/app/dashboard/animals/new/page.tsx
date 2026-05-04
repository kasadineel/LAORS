import { ModuleKey } from "@prisma/client"
import { redirect } from "next/navigation"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { getRoleDisplayName } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { parseDateInput, requireStockerAccess, toDateInputValue } from "@/lib/stocker"
import { gridStyle, inputStyle, pageStyle, stackStyle } from "@/lib/stocker-ui"

export default async function NewAnimalPage() {
  const core = await requireStockerAccess()
  const orgId = core.activeOrganizationId
  await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

  async function createAnimal(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const tagNumber = (formData.get("tagNumber")?.toString() || "").trim() || null
    const name = (formData.get("name")?.toString() || "").trim() || null
    const sexClass = (formData.get("sexClass")?.toString() || "").trim() || null
    const birthDate = parseDateInput(formData.get("birthDate"))
    const notes = (formData.get("notes")?.toString() || "").trim() || null

    await prisma.animal.create({
      data: {
        tagNumber,
        name,
        sexClass,
        birthDate,
        notes,
        organizationId: orgId,
      },
    })

    redirect("/dashboard/animals")
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Add Animal"
        subtitle="Create a ranch record for an individual animal so weights, health notes, and field events all stay attached to one history."
        badge="Core Records"
      />
      <StatusRow organizationName={core.organization.name} roleLabel={getRoleDisplayName(core.role)} />
      <ActionBar primaryAction={{ href: "/dashboard/animals", label: "Back to Animals" }} />

      <CardSection title="New Animal Record">
        <form action={createAnimal} style={{ ...stackStyle, maxWidth: 760 }}>
          <div style={gridStyle}>
            <Input label="Tag Number" name="tagNumber" placeholder="3021" style={inputStyle} />
            <Input label="Name" name="name" placeholder="Black steer" style={inputStyle} />
            <Input label="Sex Class" name="sexClass" placeholder="STEER" style={inputStyle} />
            <Input label="Birth Date" name="birthDate" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
          </div>
          <Textarea label="Notes" name="notes" rows={3} placeholder="Color, source, or handling notes" style={inputStyle} />
          <div>
            <Button type="submit" variant="primary">
              Save Animal
            </Button>
          </div>
        </form>
      </CardSection>
    </main>
  )
}
