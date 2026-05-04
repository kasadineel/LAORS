import Link from "next/link"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { InvoiceLineSource, InvoiceStatus, ModuleKey, StockerActivityType } from "@prisma/client"
import { QuickSubmitButton } from "@/components/stocker/quick-submit-button"
import { Button } from "@/components/stocker/ui/Button"
import { Input } from "@/components/stocker/ui/Input"
import { Select } from "@/components/stocker/ui/Select"
import { logStockerActivity } from "@/lib/stocker-activity"
import { findExistingNonVoidInvoiceForMonth, getInvoiceBillingMonth, roundMoney } from "@/lib/stocker-billing"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import { requireRole, ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import {
  appendStockerSavedParam,
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  sanitizeReturnTo,
  toDateInputValue,
} from "@/lib/stocker"
import {
  cardStyle,
  emptyStateStyle,
  gridStyle,
  inputStyle,
  pageHeaderStyle,
  pageStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  sectionCardStyle,
  stackStyle,
} from "@/lib/stocker-ui"

type QuickInvoicePageProps = {
  searchParams?: Promise<{ returnTo?: string | string[] }> | { returnTo?: string | string[] }
}

export default async function QuickInvoicePage({ searchParams }: QuickInvoicePageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const returnToParam = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo
  const returnTo = sanitizeReturnTo(returnToParam)
  const orgId = core.activeOrganizationId

  const owners = await prisma.owner.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  async function createQuickInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)
    await requireRole({
      userId: core.user.id,
      organizationId: orgId,
      allowedRoles: [ROLE_OWNER, ROLE_MANAGER],
    })

    const targetReturnTo = sanitizeReturnTo(formData.get("returnTo")?.toString())
    const ownerId = formData.get("ownerId")?.toString()
    const date = parseDateInput(formData.get("date"), new Date())
    const description = formData.get("description")?.toString().trim()
    const quantity = parseNumberInput(formData.get("quantity"))
    const price = parseNumberInput(formData.get("price"))
    const intent = formData.get("intent")?.toString()

    if (!ownerId || !date || !description || quantity === null || price === null) return

    const owner = await prisma.owner.findFirst({
      where: { id: ownerId, organizationId: orgId },
      select: { id: true, name: true },
    })

    if (!owner) return

    const amount = roundMoney(quantity * price)
    const monthValue = getInvoiceBillingMonth(date)
    const monthStart = new Date(`${monthValue}-01T00:00:00.000Z`)
    const monthEnd = new Date(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)

    const invoiceResult = await prisma.$transaction(async (tx) => {
      const existingInvoice = await findExistingNonVoidInvoiceForMonth(
        {
          organizationId: orgId,
          ownerId,
          monthStart,
          monthEnd,
          monthValue,
        },
        tx,
      )

      if (existingInvoice) {
        return { id: existingInvoice.id, reused: true as const }
      }

      const createdInvoice = await tx.invoice.create({
        data: {
          ownerId,
          organizationId: orgId,
          date,
          billingMonth: monthValue,
          status: InvoiceStatus.DRAFT,
          total: amount,
          lines: {
            create: {
              source: InvoiceLineSource.MANUAL,
              generated: false,
              quantity,
              description,
              price,
              amount,
            },
          },
        },
        select: { id: true },
      })

      return { id: createdInvoice.id, reused: false as const }
    })

    if (!invoiceResult.reused) {
      await logStockerActivity({
        organizationId: orgId,
        type: StockerActivityType.INVOICE_CREATED,
        message: `Created invoice for ${owner.name} totaling $${amount.toFixed(2)}.`,
        metadata: {
          ownerId,
          ownerName: owner.name,
          date: date.toISOString(),
          total: amount,
          lineCount: 1,
        },
        createdByUserId: core.user.id,
      })
    }

    revalidatePath("/dashboard/stocker")
    revalidatePath("/dashboard/stocker/invoices")

    if (invoiceResult.reused) {
      redirect(`/dashboard/stocker/invoices?invoiceId=${encodeURIComponent(invoiceResult.id)}`)
    }

    if (intent === "add-another") {
      redirect(`/dashboard/stocker/quick/invoice?returnTo=${encodeURIComponent(targetReturnTo)}`)
    }

    redirect(appendStockerSavedParam(targetReturnTo, "invoice"))
  }

  return (
    <main style={pageStyle}>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>Quick Invoice</h1>
          <p style={pageSubtitleStyle}>Create a single-line invoice fast, then return to the page you were working on.</p>
        </div>
        <Link className="stocker-link" href={returnTo} style={{ alignSelf: "center", fontWeight: 700 }}>
          Back
        </Link>
      </div>

      <section className="stocker-section" style={{ ...sectionCardStyle, maxWidth: 760 }}>
        {owners.length === 0 ? (
          <div className="stocker-empty-state" style={emptyStateStyle}>
            Create an owner before using quick invoice entry.
          </div>
        ) : (
          <form action={createQuickInvoice} style={stackStyle}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="stocker-card" style={{ ...cardStyle, padding: 16 }}>
              <strong style={{ color: "var(--stocker-navy)" }}>One-line billing</strong>
              <p style={{ marginBottom: 0, color: "var(--stocker-muted)" }}>
                This quick entry creates a single invoice with one line item and auto-calculates the total.
              </p>
            </div>

            <div style={gridStyle}>
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

              <Input
                label="Invoice date"
                type="date"
                name="date"
                defaultValue={toDateInputValue(new Date())}
                required
                style={inputStyle}
              />

              <Input
                label="Description"
                name="description"
                required
                style={inputStyle}
              />

              <Input
                label="Quantity"
                type="number"
                name="quantity"
                min="0"
                step="0.01"
                inputMode="decimal"
                required
                style={inputStyle}
              />

              <Input
                label="Price"
                type="number"
                name="price"
                min="0"
                step="0.01"
                inputMode="decimal"
                required
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <QuickSubmitButton>Save &amp; Return</QuickSubmitButton>
              <Button
                type="submit"
                name="intent"
                value="add-another"
                variant="secondary"
              >
                Save &amp; Add Another
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
