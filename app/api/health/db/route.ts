import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiMonitoring } from "@/lib/apiMonitor";

export const GET = withApiMonitoring("GET /api/health/db", async () => {
  // Keep this minimal (no secrets, no PII). Just prove DB connectivity.
  const rows = await prisma.$queryRaw<Array<{ db: string }>>`
    select current_database() as db
  `;
  return NextResponse.json({
    ok: true,
    db: rows?.[0]?.db ?? null,
    time: new Date().toISOString(),
  });
});

