import type { CSSProperties, ReactNode } from "react"

type ChipProps = {
  children: ReactNode
  tone?: "default" | "soft"
  className?: string
  style?: CSSProperties
}

export function Chip({ children, tone = "default", className, style }: ChipProps) {
  const resolvedStyle: CSSProperties =
    tone === "soft"
      ? {
          display: "inline-flex",
          alignItems: "center",
          padding: "7px 12px",
          borderRadius: 999,
          background: "rgba(243, 235, 221, 0.92)",
          border: "1px solid var(--border)",
          color: "var(--navyAccent)",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          lineHeight: 1.2,
        }
      : {
          display: "inline-flex",
          alignItems: "center",
          padding: "7px 12px",
          borderRadius: 999,
          background: "rgba(255, 255, 255, 0.92)",
          border: "1px solid var(--border)",
          color: "var(--ink)",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          lineHeight: 1.2,
        }

  return (
    <span
      className={["stocker-ui-chip", `stocker-ui-chip-${tone}`, className].filter(Boolean).join(" ")}
      style={{ ...resolvedStyle, ...style }}
    >
      {children}
    </span>
  )
}
