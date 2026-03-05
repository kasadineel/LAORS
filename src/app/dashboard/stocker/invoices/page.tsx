import { revalidatePath } from "next/cache"
import { ModuleKey } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireModuleForOrganization } from "@/lib/module-entitlements"
import {
  parseDateInput,
  parseNumberInput,
  requireStockerAccess,
  toDateInputValue,
} from "@/lib/stocker"
import { buttonStyle, cardStyle, gridStyle, inputStyle, pageStyle, secondaryButtonStyle } from "@/lib/stocker-ui"

const LINE_COUNT = 3

export default async function InvoicesPage() {
  const core = await requireStockerAccess()
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
        date: true,
        total: true,
        owner: { select: { name: true } },
        lines: {
          select: {
            id: true,
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

  async function createInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const ownerId = formData.get("ownerId")?.toString()
    const date = parseDateInput(formData.get("date"), new Date())
    if (!ownerId || !date) return

    const owner = await prisma.owner.findFirst({
      where: { id: ownerId, organizationId: orgId },
      select: { id: true },
    })

    if (!owner) return

    const lines = Array.from({ length: LINE_COUNT }, (_, index) => {
      const description = formData.get(`description_${index}`)?.toString().trim() || ""
      const quantity = parseNumberInput(formData.get(`quantity_${index}`))
      const weight = parseNumberInput(formData.get(`weight_${index}`))
      const price = parseNumberInput(formData.get(`price_${index}`))
      const amountInput = parseNumberInput(formData.get(`amount_${index}`))

      if (!description || quantity === null || price === null) return null

      return {
        quantity,
        description,
        weight,
        price,
        amount: amountInput ?? quantity * price,
      }
    }).filter((line): line is NonNullable<typeof line> => line !== null)

    if (lines.length === 0) return

    const total = lines.reduce((sum, line) => sum + line.amount, 0)

    await prisma.invoice.create({
      data: {
        ownerId,
        organizationId: orgId,
        date,
        total,
        lines: {
          create: lines,
        },
      },
    })

    revalidatePath("/dashboard/stocker/invoices")
    revalidatePath("/dashboard/stocker")
  }

  async function deleteInvoice(formData: FormData) {
    "use server"

    await requireModuleForOrganization(orgId, ModuleKey.STOCKER)

    const invoiceId = formData.get("invoiceId")?.toString()
    if (!invoiceId) return

    await prisma.invoice.deleteMany({
      where: {
        id: invoiceId,
        organizationId: orgId,
      },
    })

    revalidatePath("/dashboard/stocker/invoices")
    revalidatePath("/dashboard/stocker")
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ marginTop: 0 }}>Invoices</h1>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Create Invoice</h2>
        {owners.length === 0 ? (
          <p>Create an owner before billing.</p>
        ) : (
          <form action={createInvoice} style={{ display: "grid", gap: 12 }}>
            <div style={gridStyle}>
              <select name="ownerId" defaultValue="" style={inputStyle}>
                <option value="" disabled>
                  Select owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
              <input name="date" type="date" defaultValue={toDateInputValue(new Date())} style={inputStyle} />
            </div>

            {Array.from({ length: LINE_COUNT }).map((_, index) => (
              <div key={index} style={{ ...cardStyle, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Line {index + 1}</div>
                <div style={gridStyle}>
                  <input name={`description_${index}`} placeholder="Description" style={inputStyle} />
                  <input name={`quantity_${index}`} placeholder="Quantity" inputMode="decimal" style={inputStyle} />
                  <input name={`weight_${index}`} placeholder="Weight" inputMode="decimal" style={inputStyle} />
                  <input name={`price_${index}`} placeholder="Price" inputMode="decimal" style={inputStyle} />
                  <input name={`amount_${index}`} placeholder="Amount (optional)" inputMode="decimal" style={inputStyle} />
                </div>
              </div>
            ))}

            <div>
              <button type="submit" style={buttonStyle}>
                Save Invoice
              </button>
            </div>
          </form>
        )}
      </section>

      <section style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {invoices.length === 0 ? (
          <p>No invoices yet.</p>
        ) : (
          invoices.map((invoice) => (
            <article key={invoice.id} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>{invoice.owner.name}</strong>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{invoice.date.toLocaleDateString()}</div>
                </div>
                <div style={{ fontWeight: 700 }}>${invoice.total.toFixed(2)}</div>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {invoice.lines.map((line) => (
                  <div key={line.id} style={{ borderTop: "1px solid #f3f4f6", paddingTop: 8 }}>
                    <div>{line.description}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Qty {line.quantity} | Weight {line.weight ?? "—"} | Price ${line.price.toFixed(2)} | Amount $
                      {line.amount.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <form action={deleteInvoice} style={{ marginTop: 12 }}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <button type="submit" style={secondaryButtonStyle}>
                  Delete Invoice
                </button>
              </form>
            </article>
          ))
        )}
      </section>
    </main>
  )
}
