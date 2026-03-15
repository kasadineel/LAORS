import type { CSSProperties, ReactNode } from "react"

type CardProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function Card({ children, className, style }: CardProps) {
  return (
    <div
      className={["stocker-ui-card", className].filter(Boolean).join(" ")}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 22,
        boxShadow: "var(--shadow)",
        ...style,
      }}
    >
      {children}
    </div>
  )
}
