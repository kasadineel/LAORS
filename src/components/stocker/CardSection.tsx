import Link from "next/link"
import type { ReactNode } from "react"

type CardSectionProps = {
  title: string
  rightSlot?: ReactNode
  rightLink?: {
    href: string
    label: string
  }
  id?: string
  children: ReactNode
}

export function CardSection({ title, rightSlot, rightLink, id, children }: CardSectionProps) {
  return (
    <section
      id={id}
      className="stocker-card"
      style={{
        borderRadius: 22,
        marginTop: 24,
        padding: 18,
        background: "var(--card)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, color: "var(--stocker-navy)" }}>{title}</h2>
        {rightSlot ? (
          rightSlot
        ) : rightLink ? (
          <Link className="stocker-link" href={rightLink.href} style={{ fontWeight: 700 }}>
            {rightLink.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  )
}
