import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const users = await prisma.user.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      clerkUserId: true,
      email: true,
      name: true,
      createdAt: true,
      memberships: {
        select: {
          role: true,
          organization: { select: { id: true, name: true } },
        },
      },
    },
  })

  const orgs = await prisma.organization.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true },
  })

  return NextResponse.json({ users, orgs })
}