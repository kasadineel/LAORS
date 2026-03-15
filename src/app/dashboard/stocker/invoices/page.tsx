import { revalidatePath } from "next/cache"
import { ActionBar } from "@/components/stocker/ActionBar"
import { CardSection } from "@/components/stocker/CardSection"
import { PageHeader } from "@/components/stocker/PageHeader"
import { StatusRow } from "@/components/stocker/StatusRow"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { InvoiceLineSource, InvoiceStatus, ModuleKey, StockerActivityType } from "@prisma/client"
import { logStockerActivity } from "@/lib/stocker-activity"
import { getInvoiceBillingMonth } from "@/lib/stocker-billing"
import { getInvoiceLineSourceLabel, getInvoiceStatusLabel } from "@/lib/stocker-labels"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { getRoleDisplayName, requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import {
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  toDateInputValue,
} from "@/lib/stocker"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  metaTextStyle,
  pageStyle,
  stackStyle,
} from "@/lib/stocker-ui"

const CREATE_LINE_COUNT = 3
const EDIT_EXTRA_LINE_COUNT = 3

export default async function InvoicesPage() {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const orgId = core.activeOrganizationId

  const [owners, invoices] = await Promise.all([
    prisma.owner.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId: orgId },
      orderBy: { date: "desc" },
      select: {
        id: true,
        ownerId: true,
        date: true,
        billingMonth: true,
        status: true,
        total: true,
        finalizedAt: true,
        owner: { select: { name: true } },
        lines: {
          select: {
            id: true,
            source: true,
            generated: true,
            quantity: true,
            description: true,
            weight: true,
            price: true,
            amount: true,
          },
        },
      },
    }),
  ])
  const activeInvoices = invoices.filter((invoice) => invoice.status !== InvoiceStatus.VOID)
  const voidedInvoices = invoices.filter((invoice) => invoice.status === InvoiceStatus.VOID)

  async function createInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const ownerId = formData.get("ownerId")?.toString()
    const date = parseDateInput(formData.get("date"), new Date())
    if (!ownerId || !date) return

    const owner = await prisma.owner.findFirst({
      where: { id: ownerId, organizationId: orgId },
      select: { id: true, name: true },
    })

    if (!owner) return

    const lines = collectInvoiceLines(formData, CREATE_LINE_COUNT, "new")

    if (lines.length === 0) return

    const total = lines.reduce((sum, line) => sum + line.amount, 0)

    await prisma.invoice.create({
      data: {
        ownerId,
        organizationId: orgId,
        date,
        billingMonth: getInvoiceBillingMonth(date),
        status: InvoiceStatus.DRAFT,
        total,
        lines: {
          create: lines.map((line) => ({
            ...line,
            source: InvoiceLineSource.MANUAL,
            generated: false,
          })),
        },
      },
    })

    await logStockerActivity({
      organizationId: orgId,
      type: StockerActivityType.INVOICE_CREATED,
      message: `Created invoice for ${owner.name} totaling $${total.toFixed(2)}.`,
      metadata: {
        ownerId,
        ownerName: owner.name,
        date: date.toISOString(),
        total,
        lineCount: lines.length,
      },
      createdByUserId: core.user.id,
    })

    revalidatePath("/dashboard/stocker/invoices")
    revalidatePath("/dashboard/stocker")
  }

  async function updateInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const invoiceId = formData.get("invoiceId")?.toString()
    const ownerId = formData.get("ownerId")?.toString()
    const lineCount = Math.max(Math.trunc(parseNumberInput(formData.get("lineCount"), 0) ?? 0), 0)
    const date = parseDateInput(formData.get("date"), new Date())
    if (!invoiceId || !ownerId || !date || lineCount === 0) return

    const [existingInvoice, owner] = await Promise.all([
      prisma.invoice.findFirst({
        where: { id: invoiceId, organizationId: orgId },
        select: { id: true, status: true, owner: { select: { name: true } } },
      }),
      prisma.owner.findFirst({
        where: { id: ownerId, organizationId: orgId },
        select: { id: true, name: true },
      }),
    ])

    if (!existingInvoice || !owner) return
    if (existingInvoice.status !== InvoiceStatus.DRAFT) return

    const lines = collectInvoiceLines(formData, lineCount, "edit")
    if (lines.length === 0) return

    const total = lines.reduce((sum, line) => sum + line.amount, 0)

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({
        where: { invoiceId: existingInvoice.id },
      })

      await tx.invoice.update({
        where: { id: existingInvoice.id },
        data: {
          ownerId: owner.id,
          date,
          billingMonth: getInvoiceBillingMonth(date),
          total,
          lines: {
            create: lines,
          },
        },
      })
    })

    revalidatePath("/dashboard/stocker/invoices")
    revalidatePath("/dashboard/stocker/reports")
    revalidatePath("/dashboard/stocker")
  }

  async function finalizeInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const invoiceId = formData.get("invoiceId")?.toString()
    if (!invoiceId) return

    await prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        organizationId: orgId,
        status: InvoiceStatus.DRAFT,
      },
      data: {
        status: InvoiceStatus.FINALIZED,
        finalizedAt: new Date(),
        finalizedById: core.user.id,
      },
    })

    revalidatePath("/dashboard/stocker/invoices")
    revalidatePath("/dashboard/stocker/reports")
  }

  async function voidInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const invoiceId = formData.get("invoiceId")?.toString()
    if (!invoiceId) return

    await prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        organizationId: orgId,
        status: { not: InvoiceStatus.VOID },
      },
      data: {
        status: InvoiceStatus.VOID,
      },
    })

    revalidatePath("/dashboard/stocker/invoices")
    revalidatePath("/dashboard/stocker")
    revalidatePath("/dashboard/stocker/reports")
  }

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Invoices"
        subtitle="Issue and manage billing documents after the monthly review is complete."
        badge="Stocker"
      />
      <StatusRow
        organizationName={core.organization.name}
        roleLabel={getRoleDisplayName(core.role)}
      />
      <ActionBar primaryAction={{ href: "#new-invoice", label: "+ New Invoice" }} />

      <CardSection id="new-invoice" title="New Invoice">
        {owners.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>Create an owner before billing.</div>
        ) : (
          <form action={createInvoice} style={stackStyle}>
            <div style={gridStyle}>
              <Select label="Owner" name="ownerId" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Select owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>
              <Input label="Invoice date" name="date" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
            </div>

            {Array.from({ length: CREATE_LINE_COUNT }).map((_, index) => (
              <div key={index} className="stocker-card" style={{ ...cardStyle, padding: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--stocker-navy)" }}>Line {index + 1}</div>
                <div style={gridStyle}>
                  <Input label="Description" name={`new_description_${index}`} style={inputStyle} />
                  <Input label="Quantity" name={`new_quantity_${index}`} inputMode="decimal" style={inputStyle} />
                  <Input label="Weight" name={`new_weight_${index}`} inputMode="decimal" style={inputStyle} />
                  <Input label="Price" name={`new_price_${index}`} inputMode="decimal" style={inputStyle} />
                  <Input label="Amount" name={`new_amount_${index}`} inputMode="decimal" style={inputStyle} />
                </div>
              </div>
            ))}

            <div>
              <Button type="submit" variant="primary">
                Save Invoice
              </Button>
            </div>
          </form>
        )}
      </CardSection>

      <CardSection title="Active Invoice Ledger">
        <p style={{ ...metaTextStyle, marginTop: 0, marginBottom: 16, lineHeight: 1.7 }}>
          Draft and finalized invoices stay in the active ledger. Voided invoices move to archive below and do not count toward current billing totals.
        </p>
        {activeInvoices.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            <strong style={{ display: "block", marginBottom: 8 }}>No active invoices right now.</strong>
            Create a new invoice or review the void archive below.
          </div>
        ) : (
          <div style={stackStyle}>
            {activeInvoices.map((invoice) => (
              <article key={invoice.id} className="stocker-card" style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ color: "var(--stocker-navy)" }}>{invoice.owner.name}</strong>
                    <div style={metaTextStyle}>
                      {getInvoiceStatusLabel(invoice.status)} · {invoice.billingMonth ?? toDateInputValue(invoice.date).slice(0, 7)} · {invoice.lines.length} line
                      {invoice.lines.length === 1 ? "" : "s"}
                    </div>
                    {invoice.finalizedAt ? (
                      <div style={metaTextStyle}>Finalized {invoice.finalizedAt.toLocaleDateString()}</div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800, color: "var(--ink)" }}>${invoice.total.toFixed(2)}</div>
                    <Button href={`/dashboard/stocker/invoices/${invoice.id}/print`} variant="secondary" size="sm">
                      Print
                    </Button>
                  </div>
                </div>

                {invoice.status === InvoiceStatus.DRAFT ? (
                  <>
                    <form action={updateInvoice} style={{ ...stackStyle, marginTop: 16 }}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input type="hidden" name="lineCount" value={invoice.lines.length + EDIT_EXTRA_LINE_COUNT} />

                      <div style={gridStyle}>
                        <Select label="Owner" name="ownerId" defaultValue={invoice.ownerId} style={inputStyle}>
                          {owners.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {owner.name}
                            </option>
                          ))}
                        </Select>
                        <Input label="Invoice date" name="date" type="date" defaultValue={toDateInputValue(invoice.date)} style={inputStyle} />
                      </div>

                      {Array.from({ length: invoice.lines.length + EDIT_EXTRA_LINE_COUNT }).map((_, index) => {
                        const line = invoice.lines[index]

                        return (
                          <div key={line?.id ?? `extra-${index}`} className="stocker-card" style={{ ...cardStyle, padding: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                              <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>
                                {line ? `Line ${index + 1}` : `Extra Charge ${index - invoice.lines.length + 1}`}
                              </div>
                              {line ? (
                                <div style={metaTextStyle}>
                                  {getInvoiceLineSourceLabel(line.source)} · {line.generated ? "Generated" : "Manual"}
                                </div>
                              ) : (
                                <div style={metaTextStyle}>Manual extra charge</div>
                              )}
                            </div>
                            {line ? (
                              <>
                                <input type="hidden" name={`edit_source_${index}`} value={line.source} />
                                <input type="hidden" name={`edit_generated_${index}`} value={line.generated ? "true" : "false"} />
                              </>
                            ) : null}
                            <div style={gridStyle}>
                              <Input
                                label="Description"
                                name={`edit_description_${index}`}
                                defaultValue={line?.description ?? ""}
                                style={inputStyle}
                              />
                              <Input
                                label="Quantity"
                                name={`edit_quantity_${index}`}
                                defaultValue={line?.quantity ?? ""}
                                inputMode="decimal"
                                style={inputStyle}
                              />
                              <Input
                                label="Weight"
                                name={`edit_weight_${index}`}
                                defaultValue={line?.weight ?? ""}
                                inputMode="decimal"
                                style={inputStyle}
                              />
                              <Input
                                label="Price"
                                name={`edit_price_${index}`}
                                defaultValue={line?.price ?? ""}
                                inputMode="decimal"
                                style={inputStyle}
                              />
                              <Input
                                label="Amount"
                                name={`edit_amount_${index}`}
                                defaultValue={line?.amount ?? ""}
                                inputMode="decimal"
                                style={inputStyle}
                              />
                            </div>
                          </div>
                        )
                      })}

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <Button type="submit" variant="primary">
                          Save Changes
                        </Button>
                      </div>
                    </form>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                      <form action={finalizeInvoice}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <Button type="submit" variant="secondary">
                          Finalize Invoice
                        </Button>
                      </form>
                      <form action={voidInvoice}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <Button type="submit" variant="secondary">
                          Void Invoice
                        </Button>
                      </form>
                    </div>
                  </>
                ) : (
                  <div style={{ ...stackStyle, marginTop: 16 }}>
                    {invoice.lines.map((line, index) => (
                      <div key={line.id} className="stocker-card" style={{ ...cardStyle, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>Line {index + 1}</div>
                          <div style={metaTextStyle}>
                            {getInvoiceLineSourceLabel(line.source)} · {line.generated ? "Generated" : "Manual"}
                          </div>
                        </div>
                        <div style={{ ...metaTextStyle, marginTop: 8 }}>
                          {line.description} · Qty {line.quantity} · Price ${line.price.toFixed(2)} · Amount ${line.amount.toFixed(2)}
                        </div>
                        {line.weight !== null ? (
                          <div style={{ ...metaTextStyle, marginTop: 6 }}>Weight {line.weight}</div>
                        ) : null}
                      </div>
                    ))}

                    {invoice.status === InvoiceStatus.FINALIZED ? (
                      <form action={voidInvoice}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <Button type="submit" variant="secondary">
                          Void Invoice
                        </Button>
                      </form>
                    ) : null}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </CardSection>

      {voidedInvoices.length > 0 ? (
        <CardSection title="Voided Invoice Archive">
          <details
            style={{
              border: "1px solid rgba(16, 42, 67, 0.08)",
              borderRadius: 16,
              padding: 14,
              background: "rgba(255, 255, 255, 0.7)",
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--ink)" }}>
              View {voidedInvoices.length} voided invoice{voidedInvoices.length === 1 ? "" : "s"}
            </summary>
            <div style={{ ...metaTextStyle, marginTop: 10, lineHeight: 1.7 }}>
              Archived invoices stay here for reference only. They are excluded from dashboard and monthly billing totals.
            </div>
            <div style={{ ...stackStyle, marginTop: 14 }}>
              {voidedInvoices.map((invoice) => (
                <article key={invoice.id} className="stocker-card" style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <strong style={{ color: "var(--stocker-navy)" }}>{invoice.owner.name}</strong>
                      <div style={metaTextStyle}>
                        {getInvoiceStatusLabel(invoice.status)} · {invoice.billingMonth ?? toDateInputValue(invoice.date).slice(0, 7)} · {invoice.lines.length} line
                        {invoice.lines.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 800, color: "var(--ink)" }}>${invoice.total.toFixed(2)}</div>
                      <Button href={`/dashboard/stocker/invoices/${invoice.id}/print`} variant="secondary" size="sm">
                        Print
                      </Button>
                    </div>
                  </div>
                  <div style={{ ...stackStyle, marginTop: 16 }}>
                    {invoice.lines.map((line, index) => (
                      <div key={line.id} className="stocker-card" style={{ ...cardStyle, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700, color: "var(--stocker-navy)" }}>Line {index + 1}</div>
                          <div style={metaTextStyle}>
                            {getInvoiceLineSourceLabel(line.source)} · {line.generated ? "Generated" : "Manual"}
                          </div>
                        </div>
                        <div style={{ ...metaTextStyle, marginTop: 8 }}>
                          {line.description} · Qty {line.quantity} · Price ${line.price.toFixed(2)} · Amount ${line.amount.toFixed(2)}
                        </div>
                        {line.weight !== null ? (
                          <div style={{ ...metaTextStyle, marginTop: 6 }}>Weight {line.weight}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </details>
        </CardSection>
      ) : null}
    </main>
  )
}

function collectInvoiceLines(formData: FormData, lineCount: number, prefix: string) {
  type InvoiceLineDraft = {
    source: InvoiceLineSource
    generated: boolean
    quantity: number
    description: string
    weight: number | null
    price: number
    amount: number
  }

  return Array.from({ length: lineCount }, (_, index) => {
    const description = formData.get(`${prefix}_description_${index}`)?.toString().trim() || ""
    const quantity = parseNumberInput(formData.get(`${prefix}_quantity_${index}`))
    const weight = parseNumberInput(formData.get(`${prefix}_weight_${index}`))
    const price = parseNumberInput(formData.get(`${prefix}_price_${index}`))
    const amountInput = parseNumberInput(formData.get(`${prefix}_amount_${index}`))
    const sourceValue = formData.get(`${prefix}_source_${index}`)?.toString() as InvoiceLineSource | undefined
    const generatedValue = formData.get(`${prefix}_generated_${index}`)?.toString()

    if (!description || quantity === null || price === null) return null

    return {
      source: sourceValue ?? InvoiceLineSource.MANUAL,
      generated: generatedValue === "true",
      quantity,
      description,
      weight,
      price,
      amount: amountInput ?? quantity * price,
    }
  }).filter((line): line is InvoiceLineDraft => line !== null)
}
