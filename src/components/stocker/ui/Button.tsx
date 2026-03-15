import Link from "next/link"
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react"

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
type ButtonSize = "sm" | "md"

type BaseProps = {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  style?: CSSProperties
}

type ButtonAsButtonProps = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> & {
    href?: never
  }

type ButtonAsLinkProps = BaseProps & {
  href: string
}

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps

function getBaseStyle(size: ButtonSize): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    border: "1px solid color-mix(in srgb, var(--ink) 12%, var(--border))",
    background: "var(--card)",
    color: "var(--ink)",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    textDecoration: "none",
    cursor: "pointer",
    transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
    padding: size === "sm" ? "8px 12px" : "11px 16px",
    fontSize: size === "sm" ? 13 : 14,
    lineHeight: 1.1,
    boxShadow: "0 1px 2px rgba(16, 42, 67, 0.05)",
  }
}

function getVariantStyle(variant: ButtonVariant): CSSProperties {
  if (variant === "primary") {
    return {
      background: "var(--card)",
      color: "var(--ink)",
      borderColor: "color-mix(in srgb, var(--ink) 14%, var(--border))",
      boxShadow: "0 2px 6px rgba(16, 42, 67, 0.06)",
    }
  }

  if (variant === "secondary") {
    return {
      background: "var(--card)",
      color: "var(--ink)",
      borderColor: "color-mix(in srgb, var(--ink) 10%, var(--border))",
      boxShadow: "0 1px 2px rgba(16, 42, 67, 0.05)",
    }
  }

  if (variant === "danger") {
    return {
      background: "var(--card)",
      color: "var(--ink)",
      borderColor: "color-mix(in srgb, var(--ink) 18%, var(--border))",
      boxShadow: "0 1px 2px rgba(16, 42, 67, 0.05)",
    }
  }

  return {
    background: "var(--card)",
    color: "var(--ink)",
    borderColor: "color-mix(in srgb, var(--ink) 10%, var(--border))",
  }
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = !("href" in props) && Boolean(props.disabled)
  const resolvedStyle = {
    ...getBaseStyle(size),
    ...getVariantStyle(variant),
    ...(isDisabled
      ? {
          opacity: 0.62,
          cursor: "not-allowed",
          boxShadow: "none",
        }
      : null),
    ...style,
  }

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} className={className} style={resolvedStyle}>
        {children}
      </Link>
    )
  }

  return (
    <button {...props} className={className} style={resolvedStyle}>
      {children}
    </button>
  )
}
