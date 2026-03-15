import { notFound } from "next/navigation"
import { ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { getInvoiceLineSourceLabel, getInvoiceStatusLabel } from "@/lib/stocker-labels"
import { getMonthWindow, requireStockerAccess } from "@/lib/stocker"
import { formatMoney } from "@/lib/treatment-pricing"

type InvoicePrintPageProps = {
  params: Promise<{ id: string }> | { id: string }
}

function getInvoiceNumber(invoiceId: string, billingMonth: string | null, date: Date) {
  const monthPart = billingMonth || `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`
  return `LAORS-${monthPart.replace("-", "")}-${invoiceId.slice(-6).toUpperCase()}`
}

export default async function InvoicePrintPage({ params }: InvoicePrintPageProps) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])
  const resolvedParams = await params
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: resolvedParams.id,
      organizationId: core.activeOrganizationId,
    },
    select: {
      id: true,
      date: true,
      billingMonth: true,
      status: true,
      total: true,
      owner: {
        select: {
          name: true,
          billingAddress: true,
        },
      },
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
  })

  if (!invoice) {
    notFound()
  }

  const invoiceMonthLabel = invoice.billingMonth
    ? getMonthWindow(invoice.billingMonth).label
    : invoice.date.toLocaleDateString(undefined, { month: "long", year: "numeric" })
  const invoiceNumber = getInvoiceNumber(invoice.id, invoice.billingMonth, invoice.date)
  const preparerName = core.user.name?.trim() || "LAORS User"
  const payments = 0
  const totalDue = invoice.total - payments

  return (
    <main
      className="invoice-print-page"
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: 32,
        color: "#102A43",
        background: "#fff",
      }}
    >
      <style>{`
        @media print {
          html, body {
            background: #fff !important;
          }
          body {
            margin: 0 !important;
          }
          .invoice-print-actions,
          .dashboard-shell-header,
          .dashboard-shell-nav,
          .stocker-shell-toolbar,
          .stocker-quick-actions-shell {
            display: none !important;
          }
          .invoice-print-page {
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div
        className="invoice-print-actions"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <a
          href={`/dashboard/stocker/invoices`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #E7DED1",
            color: "#102A43",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Back to Invoices
        </a>
        <div style={{ color: "#6B7280", alignSelf: "center" }}>
          Open the browser print dialog to print or save as PDF.
        </div>
      </div>

      <header
        style={{
          display: "grid",
          gap: 24,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          paddingBottom: 24,
          borderBottom: "1px solid #E7DED1",
        }}
      >
        <div>
          <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7280", fontWeight: 700 }}>
            LAORS Stocker
          </div>
          <h1 style={{ margin: "10px 0 0", fontSize: 34, lineHeight: 1, color: "#102A43" }}>Invoice</h1>
          <div style={{ marginTop: 12, color: "#6B7280", lineHeight: 1.7 }}>
            {core.organization.name}
            <br />
            Prepared by {preparerName}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div><strong>Invoice Number:</strong> {invoiceNumber}</div>
          <div><strong>Invoice Date:</strong> {invoice.date.toLocaleDateString()}</div>
          <div><strong>Invoice Month:</strong> {invoiceMonthLabel}</div>
          <div><strong>Status:</strong> {getInvoiceStatusLabel(invoice.status)}</div>
        </div>
      </header>

      <section
        style={{
          display: "grid",
          gap: 24,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          marginTop: 28,
          marginBottom: 28,
        }}
      >
        <article
          style={{
            border: "1px solid #E7DED1",
            borderRadius: 16,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7280", fontWeight: 700 }}>
            Bill To
          </div>
          <div style={{ marginTop: 12, fontWeight: 700, color: "#102A43" }}>{invoice.owner.name}</div>
          <div style={{ marginTop: 8, color: "#6B7280", whiteSpace: "pre-line", lineHeight: 1.7 }}>
            {invoice.owner.billingAddress?.trim() || "No billing address on file."}
          </div>
        </article>

        <article
          style={{
            border: "1px solid #E7DED1",
            borderRadius: 16,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7280", fontWeight: 700 }}>
            Totals
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "#6B7280" }}>Total Cost</span>
              <strong>{formatMoney(invoice.total)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "#6B7280" }}>Payments</span>
              <strong>{formatMoney(payments)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 10, borderTop: "1px solid #E7DED1" }}>
              <span style={{ color: "#102A43", fontWeight: 700 }}>Total Due</span>
              <strong style={{ fontSize: 20 }}>{formatMoney(totalDue)}</strong>
            </div>
          </div>
        </article>
      </section>

      <section
        style={{
          border: "1px solid #E7DED1",
          borderRadius: 18,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8F3EA", textAlign: "left" }}>
              <th style={{ padding: "14px 16px" }}>Category</th>
              <th style={{ padding: "14px 16px" }}>Description</th>
              <th style={{ padding: "14px 16px", textAlign: "right" }}>Quantity</th>
              <th style={{ padding: "14px 16px", textAlign: "right" }}>Price</th>
              <th style={{ padding: "14px 16px", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} style={{ borderTop: "1px solid #E7DED1" }}>
                <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
                  <div style={{ fontWeight: 700, color: "#102A43" }}>{getInvoiceLineSourceLabel(line.source)}</div>
                  <div style={{ color: "#6B7280", marginTop: 4 }}>{line.generated ? "Generated" : "Manual"}</div>
                </td>
                <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
                  <div style={{ color: "#102A43" }}>{line.description}</div>
                  {line.weight !== null ? (
                    <div style={{ color: "#6B7280", marginTop: 4 }}>Weight: {line.weight}</div>
                  ) : null}
                </td>
                <td style={{ padding: "14px 16px", verticalAlign: "top", textAlign: "right" }}>{line.quantity}</td>
                <td style={{ padding: "14px 16px", verticalAlign: "top", textAlign: "right" }}>{formatMoney(line.price)}</td>
                <td style={{ padding: "14px 16px", verticalAlign: "top", textAlign: "right", fontWeight: 700 }}>{formatMoney(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: "1px solid #E7DED1",
          color: "#6B7280",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        {core.organization.name} · {getInvoiceStatusLabel(invoice.status)} invoice prepared by {preparerName}
      </footer>
    </main>
  )
}
