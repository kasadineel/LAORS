import { clerkMiddleware } from "@clerk/nextjs"
import type { NextRequest } from "next/server"

export default clerkMiddleware((auth: any, req: NextRequest) => {
  const path = req.nextUrl.pathname

  const isPublic =
    path === "/" ||
    path.startsWith("/sign-in") ||
    path.startsWith("/sign-up") ||
    path.startsWith("/api/health") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico"

  if (!isPublic) {
    return auth.protect()
  }
})

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
}