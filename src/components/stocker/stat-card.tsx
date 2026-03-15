import { Card } from "@/components/stocker/ui/Card"

type StatCardProps = {
  label: string
  value: string
  description: string
}

export function StatCard({ label, value, description }: StatCardProps) {
  return (
    <Card
      className="stocker-card"
      style={{
        padding: 24,
        minHeight: 188,
        display: "grid",
        alignContent: "space-between",
        gap: 14,
        background: "var(--card)",
        boxShadow: "0 16px 32px rgba(16, 42, 67, 0.08)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "clamp(2.5rem, 4vw, 3.6rem)",
          fontWeight: 700,
          color: "var(--ink)",
          letterSpacing: "-0.05em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.55, fontSize: 14 }}>{description}</p>
    </Card>
  )
}
