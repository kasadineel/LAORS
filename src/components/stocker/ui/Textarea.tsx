import type { TextareaHTMLAttributes } from "react"
import { Field } from "@/components/stocker/ui/Field"

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
}

export function Textarea({ label, className, ...props }: TextareaProps) {
  return (
    <Field label={label}>
      <textarea
        {...props}
        className={["stocker-textarea", "stocker-input", className].filter(Boolean).join(" ")}
      />
    </Field>
  )
}
