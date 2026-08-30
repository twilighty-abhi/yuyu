import crypto from "crypto";
import { NextResponse } from "next/server";
import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";
import { submitFeedback } from "@/lib/feedback";
import { withApiMonitoring } from "@/lib/apiMonitor";

const MAX_FEEDBACK_BODY_BYTES = 128 * 1024;

async function readFeedbackJson(request: Request): Promise<{ value: unknown } | { tooLarge: true } | { invalid: true }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FEEDBACK_BODY_BYTES) return { tooLarge: true };
  if (!request.body) return { invalid: true };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FEEDBACK_BODY_BYTES) {
        await reader.cancel();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { invalid: true };
  }
}

export const POST = withApiMonitoring("POST /api/feedback", async (request: Request) => {
  const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  const allowed = await checkRateLimitById("feedback", `ip:${getClientIpFromHeaders(request.headers)}`);
  if (!allowed) return json({ ok: false, error: "Too many attempts. Try again shortly." }, 429);
  const parsedBody = await readFeedbackJson(request);
  if ("tooLarge" in parsedBody) return json({ ok: false, error: "Feedback request is too large." }, 413);
  if ("invalid" in parsedBody) return json({ ok: false, error: "Invalid request." }, 400);
  const body = parsedBody.value;
  const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email) {
    const subject = crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
    if (!(await checkRateLimitById("feedback", `email:${subject}`))) return json({ ok: false, error: "Too many attempts. Try again shortly." }, 429);
  }
  const result = await submitFeedback(body);
  return json(result, result.ok ? 200 : 400);
});
