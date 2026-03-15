import type { ReactNode } from "react"
import { Button } from "@/components/stocker/ui/Button"

type ActionLink = {
  href: string
  label: string
}

type ActionBarProps = {
  primaryAction: ActionLink
  secondaryActions?: ActionLink[]
  filters?: ReactNode
}

export function ActionBar({ primaryAction, secondaryActions = [], filters }: ActionBarProps) {
  return (
    <section
      className="stocker-card"
      style={{
        borderRadius: 22,
        padding: 16,
        marginTop: 18,
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "center",
        background: "rgba(255, 255, 255, 0.94)",
      }}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Button href={primaryAction.href} variant="primary">
          {primaryAction.label}
        </Button>
        {secondaryActions.map((action) => (
          <Button key={action.href + action.label} href={action.href} variant="secondary">
            {action.label}
          </Button>
        ))}
      </div>
      {filters ? <div style={{ display: "flex", gap: 10, flexWrap: "wrap", width: "100%", justifyContent: "flex-end" }}>{filters}</div> : null}
    </section>
  )
}
