import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Card } from "@/components/stocker/ui/Card"
import { Input } from "@/components/stocker/ui/Input"
import { Table } from "@/components/stocker/ui/Table"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireStockerAccess } from "@/lib/stocker"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  metaTextStyle,
  pageStyle,
  stackStyle,
  tableContainerStyle,
} from "@/lib/stocker-ui"
import { ModuleKey } from "@prisma/client"

export default async function OwnersPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId
  const today = new Date()

  const [owners, openLots] = await Promise.all([
    prisma.owner.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        yardageRatePerHeadDay: true,
        medicineMarkupPercent: true,
        billingNotes: true,
        billingAddress: true,
        _count: {
          select: {
            lots: true,
            invoices: true,
          },
        },
      },
    }),
    prisma.lot.findMany({
      where: {
        organizationId: orgId,
        arrivalDate: { lte: today },
        OR: [{ exitDate: null }, { exitDate: { gte: today } }],
      },
      select: {
        ownerId: true,
        headCount: true,
      },
    }),
  ])

  const inventoryByOwner = new Map<string, number>()
  for (const lot of openLots) {
    inventoryByOwner.set(lot.ownerId, (inventoryByOwner.get(lot.ownerId) ?? 0) + lot.headCount)
  }
  const totalInventory = owners.reduce((sum, owner) => sum + (inventoryByOwner.get(owner.id) ?? 0), 0)
  const ownersMissingRates = owners.filter((owner) => owner.yardageRatePerHeadDay === null).length
  const ownersMissingAddress = owners.filter((owner) => !owner.billingAddress?.trim()).length

  async function createOwner(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })
    const name = formData.get("name")?.toString().trim()
    const yardageRatePerHeadDay = parseNullableNumber(formData.get("yardageRatePerHeadDay"))
    const medicineMarkupPercent = parseNullableNumber(formData.get("medicineMarkupPercent")) ?? 0
    const billingNotes = formData.get("billingNotes")?.toString().trim() || null
    const billingAddress = formData.get("billingAddress")?.toString().trim() || null
    if (!name) return

    await prisma.owner.create({
      data: {
        organizationId: orgId,
        name,
        yardageRatePerHeadDay,
        medicineMarkupPercent,
        billingNotes,
        billingAddress,
      },
    })

    revalidatePath("/dashboard/stocker/owners")
    revalidatePath("/dashboard/stocker")
  }

  async function updateOwner(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })
    const ownerId = formData.get("ownerId")?.toString()
    const name = formData.get("name")?.toString().trim()
    const yardageRatePerHeadDay = parseNullableNumber(formData.get("yardageRatePerHeadDay"))
    const medicineMarkupPercent = parseNullableNumber(formData.get("medicineMarkupPercent")) ?? 0
    const billingNotes = formData.get("billingNotes")?.toString().trim() || null
    const billingAddress = formData.get("billingAddress")?.toString().trim() || null
    if (!ownerId || !name) return

    await prisma.owner.updateMany({
      where: { id: ownerId, organizationId: orgId },
      data: { name, yardageRatePerHeadDay, medicineMarkupPercent, billingNotes, billingAddress },
    })

    revalidatePath("/dashboard/stocker/owners")
    revalidatePath("/dashboard/stocker")
  }

  async function deleteOwner(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })
    const ownerId = formData.get("ownerId")?.toString()
    if (!ownerId) return

    const owner = await prisma.owner.findFirst({
      where: { id: ownerId, organizationId: orgId },
      select: {
        _count: {
          select: {
            lots: true,
            invoices: true,
          },
        },
      },
    })

    if (!owner || owner._count.lots > 0 || owner._count.invoices > 0) return

    await prisma.owner.deleteMany({
      where: { id: ownerId, organizationId: orgId },
    })

    revalidatePath("/dashboard/stocker/owners")
    revalidatePath("/dashboard/stocker")
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Owners"
        subtitle="Review owner accounts first. Open setup only when you need to maintain billing settings or contact details."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
      />
      <ActionBar
        primaryAction={{ href: "/dashboard/stocker/reports", label: "Review Billing" }}
        secondaryActions={[
          { href: "#owner-directory", label: "Owner Directory" },
          { href: "#owner-setup", label: "Owner Setup" },
        ]}
      />

      <CardSection title="Owner Priorities">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {[
            { label: "Owners", value: `${owners.length}`, note: "Owner accounts currently on file." },
            { label: "Open Inventory", value: `${totalInventory}`, note: "Head currently tied to owner accounts." },
            { label: "Missing Yardage Rates", value: `${ownersMissingRates}`, note: ownersMissingRates > 0 ? "Billing setup still incomplete for some owners." : "All owners have yardage rates on file." },
            { label: "Missing Billing Addresses", value: `${ownersMissingAddress}`, note: ownersMissingAddress > 0 ? "Invoice delivery info still needs cleanup." : "Billing addresses are on file for all owners." },
          ].map((item) => (
            <article key={item.label} className="stocker-card" style={{ ...cardStyle, padding: 18 }}>
              <div style={{ ...metaTextStyle, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>{item.value}</div>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>{item.note}</p>
            </article>
          ))}
        </div>
      </CardSection>

      <CardSection id="owner-directory" title="Owner Directory">
        <p style={{ ...metaTextStyle, marginTop: 0, marginBottom: 16, lineHeight: 1.7 }}>
          Use this view to confirm which owners are active, how much inventory they carry, and whether billing settings are complete before month-end.
        </p>
        {owners.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No owners yet.</strong>
            Create your first owner to start tracking cattle inventory.
          </div>
        ) : (
          <>
            <div className="stocker-mobile-cards">
              {owners.map((owner) => (
                <Card key={owner.id} style={cardStyle}>
                  <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>{owner.name}</div>
                  <div style={{ ...metaTextStyle, marginTop: 8 }}>Lots: {owner._count.lots}</div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>Inventory: {inventoryByOwner.get(owner.id) ?? 0}</div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>
                    Yardage: {owner.yardageRatePerHeadDay === null ? "Not set" : `$${owner.yardageRatePerHeadDay.toFixed(2)} / head-day`}
                  </div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>Medicine markup: {owner.medicineMarkupPercent.toFixed(2)}%</div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>Invoices: {owner._count.invoices}</div>
                  <div style={{ ...metaTextStyle, marginTop: 6 }}>
                    Billing address: {owner.billingAddress ? "On file" : "Not set"}
                  </div>
                </Card>
              ))}
            </div>
            <Card className="stocker-desktop-table" style={tableContainerStyle}>
              <Table>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "8px 0" }}>Owner</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Lots</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Current Inventory</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Yardage Rate</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Medicine Markup</th>
                    <th style={{ padding: "8px 0" }} data-align="right">Invoices</th>
                    <th style={{ padding: "8px 0" }}>Billing Address</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map((owner) => (
                    <tr key={owner.id}>
                      <td style={{ padding: "10px 0", fontWeight: 700 }}>{owner.name}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">{owner._count.lots}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">{inventoryByOwner.get(owner.id) ?? 0}</td>
                      <td style={{ padding: "10px 0" }} data-align="right">
                        {owner.yardageRatePerHeadDay === null ? "Not set" : `$${owner.yardageRatePerHeadDay.toFixed(2)} / head-day`}
                      </td>
                      <td style={{ padding: "10px 0" }} data-align="right">{owner.medicineMarkupPercent.toFixed(2)}%</td>
                      <td style={{ padding: "10px 0" }} data-align="right">{owner._count.invoices}</td>
                      <td style={{ padding: "10px 0" }}>{owner.billingAddress ? "On file" : "Not set"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </>
        )}
      </CardSection>

      <CardSection id="owner-setup" title="Owner Setup">
        <details className="stocker-disclosure">
          <summary>Open owner creation and profile editing</summary>
          <div className="stocker-disclosure__body" style={{ display: "grid", gap: 18 }}>
            <form action={createOwner} style={{ ...stackStyle, maxWidth: 680 }}>
              <Input label="Owner Name" name="name" placeholder="Walton Marshall" required style={inputStyle} />
              <Input
                label="Yardage Rate ($ per head/day)"
                name="yardageRatePerHeadDay"
                placeholder="3.00"
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                style={inputStyle}
              />
              <Input
                label="Medicine Markup %"
                name="medicineMarkupPercent"
                placeholder="0"
                defaultValue="0"
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                style={inputStyle}
              />
              <Textarea
                label="Billing Notes"
                name="billingNotes"
                placeholder="Internal billing notes for invoices and owner review."
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              <Textarea
                label="Billing Address"
                name="billingAddress"
                placeholder={"Walton Marshall\n123 Ranch Road\nAustin, TX 78701"}
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              <div>
                <Button type="submit" variant="primary">
                  Save Owner
                </Button>
              </div>
            </form>

            {owners.length === 0 ? (
              <div className="stocker-empty-state" style={emptyStateStyle}>No owners to edit yet.</div>
            ) : (
              <div style={stackStyle}>
                {owners.map((owner) => (
                  <details key={owner.id} className="stocker-disclosure">
                    <summary>{owner.name}</summary>
                    <div className="stocker-disclosure__body">
                    <article className="stocker-card" style={cardStyle}>
                    <form action={updateOwner} style={stackStyle}>
                      <input type="hidden" name="ownerId" value={owner.id} />
                      <div style={gridStyle}>
                        <Input label="Owner Name" name="name" defaultValue={owner.name} required style={inputStyle} />
                        <Input
                          label="Yardage Rate ($ per head/day)"
                          name="yardageRatePerHeadDay"
                          defaultValue={owner.yardageRatePerHeadDay ?? ""}
                          inputMode="decimal"
                          type="number"
                          min="0"
                          step="0.01"
                          style={inputStyle}
                        />
                        <Input
                          label="Medicine Markup %"
                          name="medicineMarkupPercent"
                          defaultValue={owner.medicineMarkupPercent}
                          inputMode="decimal"
                          type="number"
                          min="0"
                          step="0.01"
                          style={inputStyle}
                        />
                        <Textarea
                          label="Billing Address"
                          name="billingAddress"
                          rows={3}
                          defaultValue={owner.billingAddress ?? ""}
                          style={{ ...inputStyle, resize: "vertical" }}
                        />
                      </div>
                      <Textarea
                        label="Billing Notes"
                        name="billingNotes"
                        defaultValue={owner.billingNotes ?? ""}
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical" }}
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button type="submit" variant="primary">
                          Update Owner
                        </Button>
                      </div>
                    </form>

                    <form action={deleteOwner} style={{ marginTop: 10 }}>
                      <input type="hidden" name="ownerId" value={owner.id} />
                      <Button type="submit" variant="secondary">
                        Delete
                      </Button>
                    </form>
                  </article>
                  </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </details>
      </CardSection>
    </main>
  )
}

function parseNullableNumber(value: FormDataEntryValue | null) {
  const raw = value?.toString().trim()
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${raw}`)
  }

  return parsed
}
