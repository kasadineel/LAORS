import Link from "next/link"
import { requireStockerAccess } from "@/lib/stocker"

export default async function StockerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireStockerAccess()

  return (
    <div>
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <Link href="/dashboard/stocker">Summary</Link>
        <Link href="/dashboard/stocker/owners">Owners</Link>
        <Link href="/dashboard/stocker/pens">Pens</Link>
        <Link href="/dashboard/stocker/lots">Lots</Link>
        <Link href="/dashboard/stocker/treatments">Treatments</Link>
        <Link href="/dashboard/stocker/invoices">Invoices</Link>
      </div>
      {children}
    </div>
  )
}
