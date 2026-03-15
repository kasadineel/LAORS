type StatusRowProps = {
  organizationName: string
  roleLabel: string
  monthLabel?: string
}

function StatusChip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 12px",
        borderRadius: 999,
        background: "rgba(255, 255, 255, 0.92)",
        border: "1px solid var(--border)",
        color: "var(--navyAccent)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        lineHeight: 1.2,
      }}
    >
      {label}
    </span>
  )
}

export function StatusRow({ organizationName, roleLabel, monthLabel }: StatusRowProps) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
      <StatusChip label={organizationName} />
      <StatusChip label={roleLabel} />
      <StatusChip label="Stocker Module" />
      {monthLabel ? <StatusChip label={monthLabel} /> : null}
    </div>
  )
}
