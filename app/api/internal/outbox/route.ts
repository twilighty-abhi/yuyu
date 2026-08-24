import crypto from "crypto";
import { NextResponse } from "next/server";
import { runOutboxScheduler } from "@/lib/outboxWorker";

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configuredSecret || suppliedSecret.length !== configuredSecret.length || !crypto.timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(configuredSecret))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const result = await runOutboxScheduler();
  return NextResponse.json({ ok: true, ...result });
}
