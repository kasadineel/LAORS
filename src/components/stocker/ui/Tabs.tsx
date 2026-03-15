"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

type TabItem = {
  href: string
  label: string
}

type TabsProps = {
  items: TabItem[]
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard/stocker") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Tabs({ items }: TabsProps) {
  const pathname = usePathname()

  return (
    <div className="stocker-ui-tabs" role="tablist" aria-label="Stocker navigation">
      {items.map((item) => {
        const active = isActive(pathname, item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            role="tab"
            aria-selected={active}
            className={["stocker-ui-tab", active ? "stocker-ui-tab-active" : ""].filter(Boolean).join(" ")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px 12px",
              borderRadius: 999,
              color: active ? "var(--navyAccent)" : "var(--muted)",
              textDecoration: "none",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              border: active ? "1px solid var(--border)" : "1px solid transparent",
              background: active ? "var(--softTint)" : "transparent",
              boxShadow: active ? "inset 0 0 0 1px rgba(22, 58, 89, 0.03)" : "none",
            }}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
