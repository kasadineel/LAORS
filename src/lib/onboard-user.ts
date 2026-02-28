import { prisma } from "@/lib/prisma"
import { clerkClient } from "@clerk/nextjs/server"

export async function ensureUserOrganization(clerkUserId: string) {
  const client = await clerkClient()
  const cu = await client.users.getUser(clerkUserId)

  const primaryEmail =
    cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId)?.emailAddress ??
    cu.emailAddresses[0]?.emailAddress ??
    `${clerkUserId}@temp.local`

  const fullName =
    (cu.firstName || cu.lastName) ? [cu.firstName, cu.lastName].filter(Boolean).join(" ") : null

  const dbUser = await prisma.user.upsert({
    where: { clerkUserId },
    update: { email: primaryEmail, name: fullName },
    create: { clerkUserId, email: primaryEmail, name: fullName },
  })

  // ✅ Deterministic: always pick the oldest membership (or you can pick OWNER first)
  const existingMembership = await prisma.membership.findFirst({
    where: { userId: dbUser.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  })

  if (existingMembership) return existingMembership.organizationId

  const org = await prisma.organization.create({
    data: { name: "My Ranch" },
  })

  await prisma.membership.create({
    data: {
      role: "OWNER",
      userId: dbUser.id,
      organizationId: org.id,
    },
  })

  return org.id
}