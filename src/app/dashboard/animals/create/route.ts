import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { ensureUserOrganization } from "@/lib/onboard-user"

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ status: "error", message: "unauthorized" }, { status: 401 })

  const orgId = await ensureUserOrganization(userId)
  if (!orgId) return NextResponse.json({ status: "error", message: "no org" }, { status: 400 })

  const form = await req.formData()
  const tagNumber = (form.get("tagNumber")?.toString() || "").trim() || null
  const name = (form.get("name")?.toString() || "").trim() || null
  const sexClass = (form.get("sexClass")?.toString() || "").trim() || null

  await prisma.animal.create({
    data: {
      tagNumber,
      name,
      sexClass,
      organizationId: orgId,
    },
  })

  // Redirect back to list
  return NextResponse.redirect(new URL("/dashboard/animals", req.url), 303)
}