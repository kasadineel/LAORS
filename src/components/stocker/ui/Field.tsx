import type { ReactNode } from "react"

type FieldProps = {
  label: string
  children: ReactNode
}

export function Field({ label, children }: FieldProps) {
  return (
    <label className="stocker-ui-field">
      <span className="stocker-ui-field-label">{label}</span>
      {children}
    </label>
  )
}
