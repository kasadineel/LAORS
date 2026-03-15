"use client"

import { useFormStatus } from "react-dom"
import { Button } from "@/components/stocker/ui/Button"

type QuickSubmitButtonProps = {
  children: React.ReactNode
}

export function QuickSubmitButton({ children }: QuickSubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      disabled={pending}
    >
      {pending ? "Saving..." : children}
    </Button>
  )
}
