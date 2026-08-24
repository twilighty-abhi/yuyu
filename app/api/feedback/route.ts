import crypto from "crypto";
import { NextResponse } from "next/server";
import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";
import { submitFeedback } from "@/lib/feedback";
import { withApiMonitoring } from "@/lib/apiMonitor";

export const POST = withApiMonitoring("POST /api/feedback", async (request: Request) => {
  const allowed = await checkRateLimitById("feedback", `ip:${getClientIpFromHeaders(request.headers)}`);
  if (!allowed) return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 }); }
  const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email) {
    const subject = crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
    if (!(await checkRateLimitById("feedback", `email:${subject}`))) return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const result = await submitFeedback(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
});
