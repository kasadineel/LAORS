import { redirect, notFound } from "next/navigation"
import { ModuleKey } from "@prisma/client"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { prisma } from "@/lib/prisma"
import { normalizeAnimalEventType } from "@/lib/animal-events"
import { requireStockerAccess } from "@/lib/stocker"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { getRoleDisplayName } from "@/lib/permissions"
import { inputStyle, pageStyle, stackStyle } from "@/lib/stocker-ui"

export default async function LogWeightPage({ params }: { params: { id: string } }) {
  const core = await requireStockerAccess()
  await requireModuleForOrganization(core.activeOrganizationId, ModuleKey.STOCKER)

  const animal = await prisma.animal.findFirst({
    where: { id: params.id, organizationId: core.activeOrganizationId },
    select: { id: true, tagNumber: true, name: true },
  })

  if (!animal) notFound()

  // Capture non-null primitives so TS is happy inside the server action closure
  const animalId = animal.id
  const animalTagNumber = animal.tagNumber
  const animalName = animal.name
  const orgId = core.activeOrganizationId
  const createdById = core.user.id

  async function logWeight(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const weightRaw = (formData.get("weight") as string | null)?.trim()
    const notes = (formData.get("notes") as string | null)?.trim() || null

    const value = weightRaw ? Number(weightRaw) : NaN
    if (!Number.isFinite(value)) {
      throw new Error("Weight must be a number")
    }

    await prisma.event.create({
      data: {
        type: normalizeAnimalEventType("WEIGHT"),
        value,
        notes,
        animalId,
        organizationId: orgId,
        createdById,
      },
    })

    redirect(`/dashboard/animals/${animalId}`)
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Log Weight"
        subtitle="Add a dated weight record to this animal so gain and history stay tied to the record."
        badge="Core Records"
      />
      <StatusRow organizationName={core.organization.name} roleLabel={getRoleDisplayName(core.role)} />
      <ActionBar primaryAction={{ href: `/dashboard/animals/${animalId}`, label: "Back to Animal" }} />

      <CardSection title={`${animalTagNumber ? `#${animalTagNumber}` : "Animal"} ${animalName ? `· ${animalName}` : ""}`}>
        <form action={logWeight} style={{ ...stackStyle, maxWidth: 560 }}>
          <Input
            label="Weight"
            name="weight"
            placeholder="e.g. 642.5"
            inputMode="decimal"
            style={inputStyle}
          />
          <Textarea
            label="Notes"
            name="notes"
            placeholder="Morning weigh-in"
            rows={3}
            style={inputStyle}
          />
          <div>
            <Button type="submit" variant="primary">
              Save Weight
            </Button>
          </div>
        </form>
      </CardSection>
    </main>
  )
}
