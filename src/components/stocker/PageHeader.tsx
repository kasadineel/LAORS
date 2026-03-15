import type { ReactNode } from "react"

type PageHeaderProps = {
  title: string
  subtitle: string
  badge?: string
  rightSlot?: ReactNode
}

export function PageHeader({ title, subtitle, badge, rightSlot }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ maxWidth: 760 }}>
        {badge ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 12px",
              borderRadius: 999,
              background: "rgba(243, 235, 221, 0.92)",
              border: "1px solid var(--border)",
              color: "var(--navyAccent)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </div>
        ) : null}
        <h1
          style={{
            margin: badge ? "14px 0 0" : 0,
            color: "var(--ink)",
            fontWeight: 700,
            fontSize: "clamp(2.1rem, 3vw, 2.8rem)",
            lineHeight: 0.98,
            letterSpacing: "-0.04em",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            marginTop: 10,
            marginBottom: 0,
            color: "var(--muted)",
            maxWidth: 720,
            lineHeight: 1.7,
            fontSize: 15,
            fontWeight: 500,
          }}
        >
          {subtitle}
        </p>
      </div>
      {rightSlot ? <div style={{ alignSelf: "stretch" }}>{rightSlot}</div> : null}
    </div>
  )
}
