import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiMonitoring } from "@/lib/apiMonitor";
import crypto from "crypto";

export const GET = withApiMonitoring("GET /api/health/db", async (request: Request) => {
  const configuredSecret = process.env.HEALTHCHECK_SECRET;
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configuredSecret || suppliedSecret.length !== configuredSecret.length || !crypto.timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(configuredSecret))) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Deliberately avoid returning database identity, version, or connection details.
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
  });
});
