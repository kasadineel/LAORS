import Link from "next/link"
import { currentUser } from "@clerk/nextjs/server"
import { ensureCore } from "@/lib/ensure-core"
import { prisma } from "@/lib/prisma"

export default async function AnimalsPage() {
  const user = await currentUser()
  if (!user) return null

const user = await currentUser()
if (!user) {
  return (
    <main style={{ padding: 24 }}>
      <h1>Dashboard (Dev Mode)</h1>
      <p>Proxy is off, so Clerk isn’t enforcing sign-in yet.</p>
      <p>Go to /sign-in to log in, or we’ll wire protection back after DB is stable.</p>
    </main>
  )
  
}
  const core = await ensureCore({
    clerkUserId: user.id,
    email: user.emailAddresses[0]?.emailAddress ?? "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  })

  const animals = await prisma.animal.findMany({
    where: { organizationId: core.activeOrganizationId },
    orderBy: { createdAt: "desc" },
  })

  return (
    <main style={{ padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Animals</h1>
        <Link href="/dashboard/animals/new">+ Add Animal</Link>
      </header>

      {animals.length === 0 ? (
        <p style={{ marginTop: 16 }}>No animals yet. Add your first one.</p>
      ) : (
        <ul style={{ marginTop: 16, paddingLeft: 18 }}>
          {animals.map((a) => (
            <li key={a.id} style={{ marginBottom: 8 }}>
              <Link href={`/dashboard/animals/${a.id}`}>
                {a.tagNumber ? `#${a.tagNumber}` : "No Tag"}{" "}
                {a.name ? `— ${a.name}` : ""}
                {a.sexClass ? ` (${a.sexClass})` : ""}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}