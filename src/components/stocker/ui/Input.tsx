import type { InputHTMLAttributes } from "react"
import { Field } from "@/components/stocker/ui/Field"

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
}

export function Input({ label, className, ...props }: InputProps) {
  return (
    <Field label={label}>
      <input
        {...props}
        className={["stocker-input", className].filter(Boolean).join(" ")}
      />
    </Field>
  )
}
