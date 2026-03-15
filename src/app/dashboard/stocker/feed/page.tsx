import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { Table } from "@/components/stocker/ui/Table"
import { Textarea } from "@/components/stocker/ui/Textarea"
import { FeedEntryUnit, ModuleKey } from "@prisma/client"
import {
  formatFeedLbs,
  formatFeedTons,
  getFeedEntryTotalCostSnapshot,
  getFeedEntryUnitLabel,
  previewFeedAllocationForEntry,
} from "@/lib/stocker-feed"
import { getRationCostDelegate, prisma } from "@/lib/prisma"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { parseDateInput, parseNumberInput, requireStockerAccess, toDateInputValue } from "@/lib/stocker"
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

const FEED_ENTRY_ROW_COUNT = 4

type FeedPageProps = {
  searchParams?:
    | Promise<{ date?: string | string[]; notice?: string | string[] }>
    | { date?: string | string[]; notice?: string | string[] }
}

function getSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function buildFeedRedirect(date: Date, notice?: string) {
  const params = new URLSearchParams({ date: toDateInputValue(date) })
  if (notice) params.set("notice", notice)
  return `/dashboard/stocker/feed?${params.toString()}`
}

type FeedRowDraft = {
  penId: string
  rationId: string
  amount: number
  notes: string | null
}

function collectFeedRows(formData: FormData) {
  return Array.from({ length: FEED_ENTRY_ROW_COUNT }, (_, index) => {
    const penId = formData.get(`penId_${index}`)?.toString() ?? ""
    const rationId = formData.get(`rationId_${index}`)?.toString() ?? ""
    const amount = parseNumberInput(formData.get(`amount_${index}`))
    const notes = formData.get(`notes_${index}`)?.toString().trim() || null

    if (!penId || !rationId || amount === null) return null
    return {
      penId,
      rationId,
      amount,
      notes,
    }
  }).filter((row): row is FeedRowDraft => row !== null)
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId
  const rationCostDelegate = getRationCostDelegate()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const dateParam = getSingleSearchParam(resolvedSearchParams.date)
  const notice = getSingleSearchParam(resolvedSearchParams.notice)
  const selectedDate = parseDateInput(dateParam ?? null, new Date()) ?? new Date()
  const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
  const dayEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1)

  const [pens, rations, rules, feedEntries, owners] = await Promise.all([
    prisma.pen.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    rationCostDelegate.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isActive: "desc" }, { effectiveStartDate: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        costPerTon: true,
        effectiveStartDate: true,
        effectiveEndDate: true,
        isActive: true,
        notes: true,
      },
    }),
    prisma.feedAllocationRule.findMany({
      where: { organizationId: orgId },
      orderBy: [{ effectiveStartDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        penId: true,
        ownerId: true,
        allocationPercent: true,
        effectiveStartDate: true,
        effectiveEndDate: true,
        notes: true,
        pen: { select: { name: true } },
        owner: { select: { name: true } },
      },
    }),
    prisma.feedEntry.findMany({
      where: {
        organizationId: orgId,
        entryDate: { gte: dayStart, lt: dayEnd },
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        entryDate: true,
        amount: true,
        unit: true,
        costPerTonSnapshot: true,
        totalCostSnapshot: true,
        notes: true,
        pen: { select: { name: true } },
        ration: { select: { name: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
    prisma.owner.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  async function createFeedEntries(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const entryDate = parseDateInput(formData.get("entryDate"), new Date())
    if (!entryDate) return

    const rows = collectFeedRows(formData)
    if (rows.length === 0) {
      redirect(buildFeedRedirect(entryDate, "Enter at least one pen feed row to save feed."))
    }

    const penIds = [...new Set(rows.map((row) => row.penId))]
    const rationIds = [...new Set(rows.map((row) => row.rationId))]

    const [pensMap, rationsMap] = await Promise.all([
      prisma.pen.findMany({
        where: { organizationId: orgId, id: { in: penIds } },
        select: { id: true, name: true },
      }),
      prisma.rationCost.findMany({
        where: { organizationId: orgId, id: { in: rationIds } },
        select: {
          id: true,
          name: true,
          costPerTon: true,
          effectiveStartDate: true,
          effectiveEndDate: true,
          isActive: true,
        },
      }),
    ])

    const penById = new Map(pensMap.map((pen) => [pen.id, pen]))
    const rationById = new Map(rationsMap.map((ration) => [ration.id, ration]))

    for (const row of rows) {
      if (!Number.isFinite(row.amount) || row.amount <= 0) {
        redirect(buildFeedRedirect(entryDate, "Feed amount must be greater than zero."))
      }

      const pen = penById.get(row.penId)
      const ration = rationById.get(row.rationId)
      if (!pen || !ration) {
        redirect(buildFeedRedirect(entryDate, "Each feed row requires a valid pen and ration."))
      }

      const rationActiveForDate =
        ration.isActive &&
        ration.effectiveStartDate <= entryDate &&
        (!ration.effectiveEndDate || ration.effectiveEndDate >= entryDate)

      if (!rationActiveForDate) {
        redirect(buildFeedRedirect(entryDate, `${ration.name} is not active for ${toDateInputValue(entryDate)}.`))
      }

      const allocationPreview = await previewFeedAllocationForEntry(
        {
          organizationId: orgId,
          penId: row.penId,
          entryDate,
        },
      )

      if (!allocationPreview.allocatable) {
        redirect(buildFeedRedirect(entryDate, allocationPreview.reason ?? `Feed for ${pen.name} cannot be allocated yet.`))
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const ration = rationById.get(row.rationId)!
        await tx.feedEntry.create({
          data: {
            organizationId: orgId,
            penId: row.penId,
            entryDate,
            rationId: row.rationId,
            amount: row.amount,
            unit: FeedEntryUnit.LBS,
            costPerTonSnapshot: ration.costPerTon,
            totalCostSnapshot: getFeedEntryTotalCostSnapshot(row.amount, ration.costPerTon),
            notes: row.notes,
            createdById: core.user.id,
          },
        })
      }
    })

    revalidatePath("/dashboard/stocker/feed")
    revalidatePath("/dashboard/stocker/feed/monthly")
    revalidatePath("/dashboard/stocker/reports")
    redirect(buildFeedRedirect(entryDate, `Saved ${rows.length} feed entr${rows.length === 1 ? "y" : "ies"}.`))
  }

  async function createRationCost(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const name = formData.get("name")?.toString().trim()
    const costPerTon = parseNumberInput(formData.get("costPerTon"))
    const effectiveStartDate = parseDateInput(formData.get("effectiveStartDate"))
    const effectiveEndDate = parseDateInput(formData.get("effectiveEndDate"))
    const isActive = formData.get("status")?.toString() !== "inactive"
    const notes = formData.get("notes")?.toString().trim() || null

    if (!name || costPerTon === null || costPerTon < 0 || !effectiveStartDate) return

    await prisma.rationCost.create({
      data: {
        organizationId: orgId,
        name,
        costPerTon,
        effectiveStartDate,
        effectiveEndDate,
        isActive,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/feed")
    redirect(buildFeedRedirect(selectedDate, `Saved ration cost for ${name}.`))
  }

  async function updateRationCost(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const rationId = formData.get("rationId")?.toString()
    const name = formData.get("name")?.toString().trim()
    const costPerTon = parseNumberInput(formData.get("costPerTon"))
    const effectiveStartDate = parseDateInput(formData.get("effectiveStartDate"))
    const effectiveEndDate = parseDateInput(formData.get("effectiveEndDate"))
    const isActive = formData.get("status")?.toString() !== "inactive"
    const notes = formData.get("notes")?.toString().trim() || null

    if (!rationId || !name || costPerTon === null || costPerTon < 0 || !effectiveStartDate) return

    await prisma.rationCost.updateMany({
      where: { id: rationId, organizationId: orgId },
      data: {
        name,
        costPerTon,
        effectiveStartDate,
        effectiveEndDate,
        isActive,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/feed")
    revalidatePath("/dashboard/stocker/feed/monthly")
    redirect(buildFeedRedirect(selectedDate, `Updated ration ${name}.`))
  }

  async function createAllocationRule(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const penId = formData.get("penId")?.toString()
    const ownerId = formData.get("ownerId")?.toString()
    const allocationPercent = parseNumberInput(formData.get("allocationPercent"))
    const effectiveStartDate = parseDateInput(formData.get("effectiveStartDate"))
    const effectiveEndDate = parseDateInput(formData.get("effectiveEndDate"))
    const notes = formData.get("notes")?.toString().trim() || null

    if (!penId || !ownerId || allocationPercent === null || !effectiveStartDate) return
    if (allocationPercent <= 0 || allocationPercent > 100) return

    await prisma.feedAllocationRule.create({
      data: {
        organizationId: orgId,
        penId,
        ownerId,
        allocationPercent,
        effectiveStartDate,
        effectiveEndDate,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/feed")
    revalidatePath("/dashboard/stocker/feed/monthly")
    revalidatePath("/dashboard/stocker/reports")
    redirect(buildFeedRedirect(selectedDate, "Saved feed allocation rule."))
  }

  async function updateAllocationRule(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const ruleId = formData.get("ruleId")?.toString()
    const allocationPercent = parseNumberInput(formData.get("allocationPercent"))
    const effectiveStartDate = parseDateInput(formData.get("effectiveStartDate"))
    const effectiveEndDate = parseDateInput(formData.get("effectiveEndDate"))
    const notes = formData.get("notes")?.toString().trim() || null

    if (!ruleId || allocationPercent === null || !effectiveStartDate) return
    if (allocationPercent <= 0 || allocationPercent > 100) return

    await prisma.feedAllocationRule.updateMany({
      where: { id: ruleId, organizationId: orgId },
      data: {
        allocationPercent,
        effectiveStartDate,
        effectiveEndDate,
        notes,
      },
    })

    revalidatePath("/dashboard/stocker/feed")
    revalidatePath("/dashboard/stocker/feed/monthly")
    revalidatePath("/dashboard/stocker/reports")
    redirect(buildFeedRedirect(selectedDate, "Updated feed allocation rule."))
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Feed"
        subtitle="Record daily pen feed, manage ration pricing, and define how shared-pen feed is allocated to owners."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
        monthLabel={dayStart.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
      />
      <ActionBar
        primaryAction={{ href: "#daily-feed", label: "+ Daily Feed Entry" }}
        secondaryActions={[{ href: "/dashboard/stocker/feed/monthly", label: "Monthly Feed Summary" }]}
      />

      {notice ? (
        <CardSection title="Feed Status">
          <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
            <div style={{ color: "var(--ink)", fontWeight: 700 }}>{notice}</div>
          </div>
        </CardSection>
      ) : null}

      <CardSection id="daily-feed" title="Daily Feed Entry">
        {pens.length === 0 || rations.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Add at least one pen and one active ration cost before entering feed.
          </div>
        ) : (
          <form action={createFeedEntries} style={stackStyle}>
            <div style={{ ...gridStyle, gridTemplateColumns: "minmax(220px, 280px)" }}>
              <Input label="Feed Date" name="entryDate" type="date" defaultValue={toDateInputValue(selectedDate)} style={inputStyle} />
            </div>

            {Array.from({ length: FEED_ENTRY_ROW_COUNT }).map((_, index) => (
              <div key={index} className="stocker-card" style={{ ...cardStyle, padding: 14 }}>
                <div style={{ fontWeight: 700, color: "var(--stocker-navy)", marginBottom: 10 }}>Row {index + 1}</div>
                <div style={gridStyle}>
                  <Select label="Pen" name={`penId_${index}`} defaultValue="" style={inputStyle}>
                    <option value="" disabled>
                      Select pen
                    </option>
                    {pens.map((pen) => (
                      <option key={pen.id} value={pen.id}>
                        {pen.name}
                      </option>
                    ))}
                  </Select>
                  <Select label="Ration" name={`rationId_${index}`} defaultValue="" style={inputStyle}>
                    <option value="" disabled>
                      Select ration
                    </option>
                    {rations
                      .filter((ration) => ration.isActive)
                      .map((ration) => (
                        <option key={ration.id} value={ration.id}>
                          {ration.name} · ${ration.costPerTon.toFixed(2)}/ton
                        </option>
                      ))}
                  </Select>
                  <Input
                    label="Amount (lbs)"
                    name={`amount_${index}`}
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    style={inputStyle}
                  />
                  <Input label="Notes" name={`notes_${index}`} placeholder="Optional load note" style={inputStyle} />
                </div>
              </div>
            ))}

            <div style={metaTextStyle}>
              Shared pens require feed allocation rules that total 100% for the active owners on the selected date.
            </div>
            <div>
              <Button type="submit" variant="primary">
                Save Feed Entries
              </Button>
            </div>
          </form>
        )}
      </CardSection>

      <CardSection title="Ration Costs">
        <div style={stackStyle}>
          <form action={createRationCost} style={{ ...stackStyle, maxWidth: 760 }}>
            <div style={gridStyle}>
              <Input label="Ration Name" name="name" placeholder="Grower Ration" required style={inputStyle} />
              <Input label="Cost Per Ton" name="costPerTon" type="number" min="0" step="0.01" inputMode="decimal" required style={inputStyle} />
              <Input label="Effective Start" name="effectiveStartDate" type="date" defaultValue={toDateInputValue(selectedDate)} required style={inputStyle} />
              <Input label="Effective End" name="effectiveEndDate" type="date" style={inputStyle} />
              <Select label="Status" name="status" defaultValue="active" style={inputStyle}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
            <Textarea label="Notes" name="notes" rows={3} style={inputStyle} />
            <div>
              <Button type="submit" variant="primary">
                Save Ration
              </Button>
            </div>
          </form>

          {rations.length === 0 ? (
            <div className="stocker-empty-state" style={emptyStateStyle}>No ration costs saved yet.</div>
          ) : (
            <div style={stackStyle}>
              {rations.map((ration) => (
                <article key={ration.id} className="stocker-card" style={cardStyle}>
                  <form action={updateRationCost} style={stackStyle}>
                    <input type="hidden" name="rationId" value={ration.id} />
                    <div style={gridStyle}>
                      <Input label="Ration Name" name="name" defaultValue={ration.name} required style={inputStyle} />
                      <Input label="Cost Per Ton" name="costPerTon" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={ration.costPerTon} required style={inputStyle} />
                      <Input label="Effective Start" name="effectiveStartDate" type="date" defaultValue={toDateInputValue(ration.effectiveStartDate)} required style={inputStyle} />
                      <Input label="Effective End" name="effectiveEndDate" type="date" defaultValue={toDateInputValue(ration.effectiveEndDate)} style={inputStyle} />
                      <Select label="Status" name="status" defaultValue={ration.isActive ? "active" : "inactive"} style={inputStyle}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </Select>
                    </div>
                    <Textarea label="Notes" name="notes" rows={2} defaultValue={ration.notes ?? ""} style={inputStyle} />
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={metaTextStyle}>
                        ${ration.costPerTon.toFixed(2)} / ton · {ration.effectiveStartDate.toLocaleDateString()}
                        {ration.effectiveEndDate ? ` to ${ration.effectiveEndDate.toLocaleDateString()}` : " forward"}
                      </div>
                      <Button type="submit" variant="secondary">
                        Update Ration
                      </Button>
                    </div>
                  </form>
                </article>
              ))}
            </div>
          )}
        </div>
      </CardSection>

      <CardSection title="Feed Allocation Rules">
        {pens.length === 0 || owners.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Create at least one pen and one owner before defining feed allocation rules.
          </div>
        ) : (
          <div style={stackStyle}>
            <form action={createAllocationRule} style={{ ...stackStyle, maxWidth: 760 }}>
              <div style={gridStyle}>
                <Select label="Pen" name="penId" defaultValue="" required style={inputStyle}>
                  <option value="" disabled>
                    Select pen
                  </option>
                  {pens.map((pen) => (
                    <option key={pen.id} value={pen.id}>
                      {pen.name}
                    </option>
                  ))}
                </Select>
                <Select label="Owner" name="ownerId" defaultValue="" required style={inputStyle}>
                  <option value="" disabled>
                    Select owner
                  </option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </Select>
                <Input label="Allocation %" name="allocationPercent" type="number" min="0.01" max="100" step="0.01" inputMode="decimal" required style={inputStyle} />
                <Input label="Effective Start" name="effectiveStartDate" type="date" defaultValue={toDateInputValue(selectedDate)} required style={inputStyle} />
                <Input label="Effective End" name="effectiveEndDate" type="date" style={inputStyle} />
              </div>
              <Textarea label="Notes" name="notes" rows={2} style={inputStyle} />
              <div>
                <Button type="submit" variant="primary">
                  Save Allocation Rule
                </Button>
              </div>
            </form>

            {rules.length === 0 ? (
              <div className="stocker-empty-state" style={emptyStateStyle}>
                No shared-pen allocation rules yet. Single-owner pens allocate automatically.
              </div>
            ) : (
              <div style={stackStyle}>
                {rules.map((rule) => (
                  <article key={rule.id} className="stocker-card" style={cardStyle}>
                    <form action={updateAllocationRule} style={stackStyle}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <strong style={{ color: "var(--stocker-navy)" }}>
                            {rule.pen.name} → {rule.owner.name}
                          </strong>
                          <div style={metaTextStyle}>
                            Effective {rule.effectiveStartDate.toLocaleDateString()}
                            {rule.effectiveEndDate ? ` to ${rule.effectiveEndDate.toLocaleDateString()}` : " forward"}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: "var(--ink)" }}>{rule.allocationPercent.toFixed(2)}%</div>
                      </div>
                      <div style={gridStyle}>
                        <Input label="Allocation %" name="allocationPercent" type="number" min="0.01" max="100" step="0.01" inputMode="decimal" defaultValue={rule.allocationPercent} required style={inputStyle} />
                        <Input label="Effective Start" name="effectiveStartDate" type="date" defaultValue={toDateInputValue(rule.effectiveStartDate)} required style={inputStyle} />
                        <Input label="Effective End" name="effectiveEndDate" type="date" defaultValue={toDateInputValue(rule.effectiveEndDate)} style={inputStyle} />
                      </div>
                      <Textarea label="Notes" name="notes" rows={2} defaultValue={rule.notes ?? ""} style={inputStyle} />
                      <div>
                        <Button type="submit" variant="secondary">
                          Update Rule
                        </Button>
                      </div>
                    </form>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </CardSection>

      <CardSection title={`Feed Log for ${dayStart.toLocaleDateString()}`}>
        {feedEntries.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            No feed entries were logged for this date.
          </div>
        ) : (
          <Table className="stocker-desktop-table" style={tableContainerStyle}>
            <thead>
              <tr>
                <th style={{ padding: "8px 0" }}>Pen</th>
                <th style={{ padding: "8px 0" }}>Ration</th>
                <th style={{ padding: "8px 0" }}>Amount</th>
                <th style={{ padding: "8px 0" }}>Tons</th>
                <th style={{ padding: "8px 0" }}>Cost / Ton</th>
                <th style={{ padding: "8px 0" }}>Total Cost</th>
                <th style={{ padding: "8px 0" }}>Entered By</th>
              </tr>
            </thead>
            <tbody>
              {feedEntries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: "10px 0" }}>{entry.pen.name}</td>
                  <td style={{ padding: "10px 0" }}>{entry.ration.name}</td>
                  <td style={{ padding: "10px 0" }}>
                    {formatFeedLbs(entry.amount)} {entry.notes ? `· ${entry.notes}` : ""}
                  </td>
                  <td style={{ padding: "10px 0" }}>{formatFeedTons(entry.amount / 2000)}</td>
                  <td style={{ padding: "10px 0" }}>${entry.costPerTonSnapshot.toFixed(2)}</td>
                  <td style={{ padding: "10px 0" }}>${entry.totalCostSnapshot.toFixed(2)}</td>
                  <td style={{ padding: "10px 0" }}>{entry.createdBy?.name || entry.createdBy?.email || "System"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {feedEntries.length > 0 ? (
          <div style={{ ...metaTextStyle, marginTop: 12 }}>
            Feed entries store {getFeedEntryUnitLabel(FeedEntryUnit.LBS)} internally and snapshot the ration cost per ton at save time.
          </div>
        ) : null}
      </CardSection>
    </main>
  )
}
