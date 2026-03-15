"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/stocker/ui/Button"
import { Card } from "@/components/stocker/ui/Card"

type QuickActionType = "intake" | "move-split" | "treatment" | "invoice"

type QuickActionsBarProps = {
  canManage: boolean
}

type QuickAction = {
  type: QuickActionType
  href: string
  label: string
  requiresManage?: boolean
}

const QUICK_ACTIONS: QuickAction[] = [
  { type: "intake", href: "/dashboard/stocker/quick/intake", label: "+ Intake Lot", requiresManage: true },
  { type: "move-split", href: "/dashboard/stocker/quick/move-split", label: "+ Split / Transfer Lot", requiresManage: true },
  { type: "treatment", href: "/dashboard/stocker/quick/treatment", label: "+ Log Treatment" },
  { type: "invoice", href: "/dashboard/stocker/quick/invoice", label: "+ New Invoice", requiresManage: true },
]

const SUCCESS_LABELS: Record<QuickActionType, string> = {
  intake: "Lot saved",
  "move-split": "Lot split saved",
  treatment: "Treatment saved",
  invoice: "Invoice saved",
}

function cleanSearchParams(searchParams: URLSearchParams) {
  const nextParams = new URLSearchParams(searchParams)
  nextParams.delete("stockerSaved")
  nextParams.delete("returnTo")
  return nextParams
}

function buildReturnTo(pathname: string, searchParams: URLSearchParams) {
  const cleanedParams = cleanSearchParams(searchParams)
  const query = cleanedParams.toString()
  return query ? `${pathname}?${query}` : pathname
}

function buildHref(baseHref: string, returnTo: string) {
  return `${baseHref}?returnTo=${encodeURIComponent(returnTo)}`
}

function isVisibleAction(action: QuickAction, canManage: boolean) {
  if (action.requiresManage && !canManage) return false
  if (!action.href?.trim()) return false
  if (!action.label?.trim()) return false
  return true
}

export function QuickActionsBar({ canManage }: QuickActionsBarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = new URLSearchParams(searchParams.toString())
  const currentReturnTo = buildReturnTo(pathname, params)
  const successType = params.get("stockerSaved") as QuickActionType | null
  const successAction = QUICK_ACTIONS.find((action) => action.type === successType)
  const visibleActions = QUICK_ACTIONS.filter((action) => isVisibleAction(action, canManage))

  if (visibleActions.length === 0 && !successAction) {
    return null
  }

  return (
    <div
      className="stocker-quick-actions-shell"
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "12px 12px 0",
      }}
    >
      <Card
        style={{
          padding: 16,
          display: "grid",
          gap: 12,
          background: "var(--card)",
        }}
      >
        {visibleActions.length > 0 ? (
          <div style={{ display: "grid", gap: 4 }}>
            <strong
              style={{
                color: "var(--ink)",
                fontSize: 18,
                letterSpacing: "-0.02em",
                fontWeight: 700,
              }}
            >
              Quick Actions
            </strong>
            <span
              style={{
                color: "var(--muted)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Fast entry for the most common Stocker workflows.
            </span>
          </div>
        ) : null}

        {visibleActions.length > 0 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
            }}
          >
            {visibleActions.map((action) => (
              <Button
                key={action.type}
                href={buildHref(action.href, currentReturnTo)}
                variant="secondary"
                size="sm"
                style={{
                  justifyContent: "flex-start",
                  width: "fit-content",
                  minWidth: 0,
                  minHeight: 42,
                  flex: "0 0 auto",
                  whiteSpace: "nowrap",
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}

        {successAction ? (
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              borderRadius: 16,
              padding: "12px 14px",
              background: "rgba(243, 235, 221, 0.9)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
            }}
          >
            <strong>{SUCCESS_LABELS[successAction.type]}.</strong>
            <span style={{ color: "var(--muted)" }}>You are back where you started.</span>
            <Button
              href={buildHref(successAction.href, currentReturnTo)}
              variant="ghost"
              size="sm"
              style={{ marginLeft: "auto" }}
            >
              Add another
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
