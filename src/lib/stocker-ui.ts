export const pageStyle = {
  padding: 28,
  maxWidth: 1240,
  margin: "0 auto",
  color: "var(--ink)",
} as const
export const pageHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 24,
} as const
export const pageTitleStyle = {
  margin: 0,
  color: "var(--ink)",
  fontWeight: 700,
  fontSize: "clamp(2.4rem, 4vw, 3.5rem)",
  lineHeight: 0.94,
  letterSpacing: "-0.04em",
} as const
export const pageSubtitleStyle = {
  marginTop: 10,
  marginBottom: 0,
  color: "var(--muted)",
  maxWidth: 760,
  lineHeight: 1.72,
  fontSize: 15,
} as const
export const cardStyle = {
  border: "1px solid var(--border)",
  borderRadius: 22,
  padding: 22,
  background: "var(--card)",
  boxShadow: "var(--shadow)",
} as const
export const sectionCardStyle = {
  ...cardStyle,
  background: "var(--card)",
} as const
export const inputStyle = {
  width: "100%",
  minHeight: 46,
  padding: "12px 14px",
  border: "1px solid color-mix(in srgb, var(--navyAccent) 18%, var(--border))",
  borderRadius: 12,
  background: "var(--card)",
  color: "var(--ink)",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
} as const
export const buttonStyle = {
  padding: "11px 16px",
  borderRadius: 999,
  border: "1px solid var(--primary)",
  background: "var(--primary)",
  color: "#fff",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  boxShadow: "0 8px 18px rgba(139, 30, 45, 0.14)",
} as const
export const secondaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--navyAccent) 16%, var(--border))",
  background: "var(--card)",
  color: "var(--navyAccent)",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  boxShadow: "0 2px 8px rgba(16, 42, 67, 0.04)",
} as const
export const metricCardStyle = {
  ...cardStyle,
  padding: 30,
  background: "var(--card)",
  boxShadow: "0 16px 32px rgba(16, 42, 67, 0.08)",
} as const
export const metricLabelStyle = {
  fontSize: 12,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: "var(--muted)",
  fontWeight: 700,
} as const
export const metricValueStyle = {
  fontSize: "clamp(2.6rem, 5vw, 4rem)",
  fontWeight: 700,
  color: "var(--ink)",
  marginTop: 16,
  letterSpacing: "-0.05em",
} as const
export const emptyStateStyle = {
  ...cardStyle,
  padding: "14px 16px",
  color: "var(--muted)",
  borderStyle: "dashed",
  textAlign: "center" as const,
  background: "rgba(255, 255, 255, 0.72)",
} as const
export const gridStyle = {
  display: "grid",
  gap: 14,
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} as const
export const stackStyle = { display: "grid", gap: 16 } as const
export const metaTextStyle = {
  fontSize: 12,
  color: "var(--muted)",
} as const
export const splitHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
} as const
export const tableContainerStyle = {
  overflowX: "auto" as const,
  borderRadius: 16,
  background: "var(--card)",
  padding: 8,
}
