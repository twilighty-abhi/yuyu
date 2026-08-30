import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiMonitoring } from "@/lib/apiMonitor";
import { bearerSecretMatches } from "@/lib/bearerSecret";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export const GET = withApiMonitoring("GET /api/health/db", async (request: Request) => {
  if (!bearerSecretMatches(request.headers.get("authorization"), process.env.HEALTHCHECK_SECRET)) {
    return new NextResponse("Not found", { status: 404, headers: privateHeaders });
  }

  // Deliberately avoid returning database identity, version, or connection details.
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
  }, { headers: privateHeaders });
});
