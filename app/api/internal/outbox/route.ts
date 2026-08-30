import { NextResponse } from "next/server";
import { runOutboxScheduler } from "@/lib/outboxWorker";
import { bearerSecretMatches } from "@/lib/bearerSecret";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  if (!bearerSecretMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new NextResponse("Not found", { status: 404, headers: privateHeaders });
  }

  try {
    const result = await runOutboxScheduler();
    return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: "Scheduler run failed." }, { status: 500, headers: privateHeaders });
  }
}
