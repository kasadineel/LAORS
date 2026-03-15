import { ClerkProvider } from "@clerk/nextjs"
import { Inter } from "next/font/google"
import type { Metadata } from "next"
import { authConfig } from "@/lib/auth-config"

const inter = Inter({
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "LAORS",
  description: "Livestock & Ag Operations Record System",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      signInUrl={authConfig.signInUrl}
      signUpUrl={authConfig.signUpUrl}
      signInFallbackRedirectUrl={authConfig.signInFallbackRedirectUrl}
      signUpFallbackRedirectUrl={authConfig.signUpFallbackRedirectUrl}
    >
      <html lang="en" className={inter.className}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
