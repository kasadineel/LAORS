import type { CSSProperties, ReactNode } from "react"

type TableProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function Table({ children, className, style }: TableProps) {
  return (
    <div className={["stocker-ui-table-wrap", className].filter(Boolean).join(" ")} style={style}>
      <table className="stocker-ui-table">{children}</table>
    </div>
  )
}
