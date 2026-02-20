import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  try {
    const animalCount = await prisma.animal.count()
    return NextResponse.json({ status: "ok", database: "connected", animalCount })
  } catch {
    return NextResponse.json(
      { status: "error", message: "Database connection failed" },
      { status: 500 }
    )
  }
}