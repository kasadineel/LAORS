import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { authConfig } from "@/lib/auth-config"

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    const signInUrl = new URL(authConfig.signInUrl, req.url)
    signInUrl.searchParams.set("redirect_url", req.url)

    await auth.protect({
      unauthenticatedUrl: signInUrl.toString(),
    })
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|.*\\..*).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
}
