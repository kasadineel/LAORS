import { SignUp } from "@clerk/nextjs"
import { authConfig } from "@/lib/auth-config"

export default function Page() {
  return (
    <SignUp
      path={authConfig.signUpUrl}
      routing="path"
      fallbackRedirectUrl={authConfig.signUpFallbackRedirectUrl}
    />
  )
}
