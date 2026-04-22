import { NextResponse } from "next/server";
import { withApiMonitoring } from "@/lib/apiMonitor";

const startedAtMs = Date.now();

export const GET = withApiMonitoring("GET /api/health", async () => {
  const uptimeMs = Date.now() - startedAtMs;
  return NextResponse.json({
    ok: true,
    uptimeMs,
    time: new Date().toISOString(),
  });
});

