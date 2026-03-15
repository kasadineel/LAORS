import { QuickActionsBar } from "@/components/stocker/quick-actions-bar"
import { Tabs } from "@/components/stocker/ui/Tabs"
import { Button } from "@/components/stocker/ui/Button"
import { Chip } from "@/components/stocker/ui/Chip"
import { requireStockerAccess } from "@/lib/stocker"
import { canManageModules, canManageStocker, getRoleDisplayName } from "@/lib/permissions"

export default async function StockerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { role } = await requireStockerAccess()
  const canManage = canManageStocker(role)
  const items = [
    { href: "/dashboard/stocker", label: "Summary" },
    ...(canManage ? [{ href: "/dashboard/stocker/owners", label: "Owners" }] : []),
    ...(canManage ? [{ href: "/dashboard/stocker/pens", label: "Pens" }] : []),
    ...(canManage ? [{ href: "/dashboard/stocker/feed", label: "Feed" }] : []),
    ...(canManage ? [{ href: "/dashboard/stocker/lots", label: "Lots" }] : []),
    ...(canManage ? [{ href: "/dashboard/stocker/medicine", label: "Medicine" }] : []),
    { href: "/dashboard/stocker/treatments", label: "Treatments" },
    ...(canManage ? [{ href: "/dashboard/stocker/employees", label: "Employees" }] : []),
    ...(canManage ? [{ href: "/dashboard/stocker/invoices", label: "Invoices" }] : []),
    ...(canManage ? [{ href: "/dashboard/stocker/reports", label: "Reports" }] : []),
  ]

  return (
    <div className="stocker-shell">
      <div
        className="stocker-shell-toolbar"
        style={{
          padding: "18px 24px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          background: "rgba(255, 255, 255, 0.72)",
          backdropFilter: "blur(14px)",
        }}
      >
        <strong
          style={{
            color: "var(--ink)",
            marginRight: 4,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Stocker
        </strong>
        <Chip tone="soft">
          {getRoleDisplayName(role)}
        </Chip>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button href="/dashboard" variant="ghost" size="sm">Dashboard</Button>
          {canManageModules(role) ? (
            <Button href="/dashboard/settings/modules" variant="secondary" size="sm">Settings</Button>
          ) : null}
        </div>
        <div style={{ width: "100%" }}>
          <Tabs items={items} />
        </div>
      </div>
      <QuickActionsBar canManage={canManage} />
      {children}
    </div>
  )
}
