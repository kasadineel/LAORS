import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"

export const runtime = "nodejs"

export async function GET() {
  const { userId, sessionId } = await auth()
  return NextResponse.json({
    ok: true,
    userId,
    sessionId,
  })
}