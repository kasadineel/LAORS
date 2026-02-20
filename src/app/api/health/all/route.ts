import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import net from "net";

async function checkPort(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => resolve(false));
    socket.connect(port, host);
  });
}

export async function GET() {
  const keysLoaded = {
    clerkSecret: !!process.env.CLERK_SECRET_KEY,
    clerkPublishable: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    databaseUrl: !!process.env.DATABASE_URL,
    directUrl: !!process.env.DIRECT_URL,
  };

  const user = await currentUser();

  const hostMatch = (process.env.DIRECT_URL ?? "").match(/@([^:]+):/);
  const host = hostMatch?.[1];

  let tcpReachable = null;
  if (host) {
    tcpReachable = await checkPort(host, 5432);
  }

  let dbQueryWorks = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbQueryWorks = true;
  } catch {
    dbQueryWorks = false;
  }

  return NextResponse.json({
    keysLoaded,
    auth: {
      userId: user?.id ?? null,
    },
    tcpReachable,
    dbQueryWorks,
  });
}