const DEFAULT_SIGN_IN_URL = "/sign-in"
const DEFAULT_SIGN_UP_URL = "/sign-up"
const DEFAULT_DASHBOARD_URL = "/dashboard"

export const authConfig = {
  signInUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || DEFAULT_SIGN_IN_URL,
  signUpUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || DEFAULT_SIGN_UP_URL,
  signInFallbackRedirectUrl:
    process.env.CLERK_SIGN_IN_FALLBACK_REDIRECT_URL || DEFAULT_DASHBOARD_URL,
  signUpFallbackRedirectUrl:
    process.env.CLERK_SIGN_UP_FALLBACK_REDIRECT_URL || DEFAULT_DASHBOARD_URL,
} as const
