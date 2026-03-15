import type { SelectHTMLAttributes } from "react"
import { Field } from "@/components/stocker/ui/Field"

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  children: React.ReactNode
}

export function Select({ label, className, children, ...props }: SelectProps) {
  return (
    <Field label={label}>
      <select
        {...props}
        className={["stocker-select", className].filter(Boolean).join(" ")}
      >
        {children}
      </select>
    </Field>
  )
}
