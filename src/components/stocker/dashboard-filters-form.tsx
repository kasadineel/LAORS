"use client"

import { useRef } from "react"
import { Input } from "@/components/stocker/ui/Input"

type DashboardFiltersFormProps = {
  monthValue: string
  includeClosed: boolean
}

export function DashboardFiltersForm({ monthValue, includeClosed }: DashboardFiltersFormProps) {
  const formRef = useRef<HTMLFormElement>(null)

  function submitForm() {
    formRef.current?.requestSubmit()
  }

  return (
    <form ref={formRef} action="/dashboard/stocker" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong style={{ color: "var(--stocker-navy)", fontSize: 16 }}>Filters</strong>
        <span style={{ color: "var(--stocker-muted)", fontSize: 13, lineHeight: 1.6 }}>
          Adjust the report month and whether closed lots stay in view.
        </span>
      </div>
      <Input
        label="Month"
        type="month"
        name="month"
        defaultValue={monthValue}
        onChange={submitForm}
        style={{ minWidth: 170 }}
      />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid var(--border)",
          color: "var(--stocker-navy)",
          background: "var(--card)",
        }}
      >
        <input type="checkbox" name="includeClosed" value="1" defaultChecked={includeClosed} onChange={submitForm} />
        <span>{includeClosed ? "Include closed" : "Open only"}</span>
      </label>
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  )
}
