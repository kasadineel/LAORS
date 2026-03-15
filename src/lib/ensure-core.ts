import { MembershipRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"

type EnsureCoreInput = {
  clerkUserId: string
  email: string
  name: string | null
}

export async function ensureCore(input: EnsureCoreInput) {
  // 1) Ensure user exists
  const user = await prisma.$transaction(async (tx) => {
    const existingByClerkUserId = await tx.user.findUnique({
      where: { clerkUserId: input.clerkUserId },
    })

    if (existingByClerkUserId) return existingByClerkUserId

    const existingByEmail = await tx.user.findUnique({
      where: { email: input.email },
    })

    if (existingByEmail) {
      return tx.user.update({
        where: { id: existingByEmail.id },
        data: {
          clerkUserId: input.clerkUserId,
          ...(input.name ? { name: input.name } : {}),
        },
      })
    }

    return tx.user.create({
      data: {
        clerkUserId: input.clerkUserId,
        email: input.email,
        name: input.name,
      },
    })
  })

  // 2) Ensure membership exists (hybrid: single-org experience now)
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    // TODO: Prefer active memberships once Membership.active is fully aligned across schema, client, and DB.
    orderBy: { createdAt: "asc" },
  })

  if (memberships.length === 0) {
    // Create org + owner membership
    const organization = await prisma.organization.create({
      data: {
        name: input.name ? `${input.name}'s Operation` : "New Operation",
        memberships: {
          create: {
            role: MembershipRole.OWNER,
            userId: user.id,
          },
        },
      },
      include: { memberships: true },
    })

    const membership = organization.memberships[0]

    return {
      user,
      organization,
      membership,
      activeOrganizationId: organization.id,
    }
  }

  // 3) Single-org experience: pick the earliest org as “active” for now
  const activeMembership = memberships[0]
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: activeMembership.organizationId },
  })

  return {
    user,
    organization,
    membership: activeMembership,
    activeOrganizationId: organization.id,
  }
}
