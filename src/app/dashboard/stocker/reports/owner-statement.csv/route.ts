import { NextResponse } from "next/server"
import { ROLE_MANAGER, ROLE_OWNER } from "@/lib/permissions"
import {
  buildOwnerStatementCsv,
  getOwnerStatementData,
  getOwnerStatementFilename,
} from "@/lib/stocker-reports"
import { requireStockerAccess } from "@/lib/stocker"

export async function GET(request: Request) {
  const core = await requireStockerAccess([ROLE_OWNER, ROLE_MANAGER])

  const { searchParams } = new URL(request.url)
  const ownerId = searchParams.get("ownerId")?.trim()
  const month = searchParams.get("month")?.trim() || undefined

  if (!ownerId) {
    return NextResponse.json({ error: "ownerId is required" }, { status: 400 })
  }

  const statement = await getOwnerStatementData({
    organizationId: core.activeOrganizationId,
    ownerId,
    monthValue: month,
  })

  if (!statement) {
    return NextResponse.json({ error: "Owner not found" }, { status: 404 })
  }

  const csv = buildOwnerStatementCsv(statement)
  const filename = getOwnerStatementFilename(statement.owner.name, statement.monthValue)

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
