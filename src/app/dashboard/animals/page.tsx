import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { ensureUserOrganization } from "@/lib/onboard-user"

export default async function AnimalsPage() {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const orgId = await ensureUserOrganization(userId)
  if (!orgId) redirect("/sign-in")

  const animals = await prisma.animal.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tagNumber: true,
      name: true,
      sexClass: true,
      createdAt: true,
    },
  })

  // Optional debug (safe)
  console.log("[animals page] ids:", animals.map((a) => a.id))

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Animals</h1>
        <Link href="/dashboard/animals/new">Add Animal</Link>
      </div>

      <div style={{ marginTop: 16 }}>
        {animals.length === 0 ? (
          <p>No animals yet.</p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {animals.map((a) => {
              const href = `/dashboard/animals/${encodeURIComponent(a.id)}`
              return (
                <li key={a.id} style={{ marginBottom: 10 }}>
                  <Link href={href} style={{ textDecoration: "none" }}>
                    <strong>{a.tagNumber ?? "—"}</strong> — {a.name ?? "Unnamed"} (
                    {a.sexClass ?? "—"})
                  </Link>

                  {/* Optional debug to confirm href correctness */}
                  <div style={{ fontSize: 12, opacity: 0.7 }}>href: {href}</div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}