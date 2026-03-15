import { SignIn } from "@clerk/nextjs"
import { authConfig } from "@/lib/auth-config"

export default function Page() {
  return (
    <SignIn
      path={authConfig.signInUrl}
      routing="path"
      fallbackRedirectUrl={authConfig.signInFallbackRedirectUrl}
    />
  )
}
