import { z } from "zod";
import { reportOpsAlert, sanitizeAlertPath } from "@/lib/opsAlerts";
import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;

const reportSchema = z.object({
  boundary: z.enum(["route", "global", "panel"]),
  name: z.string().max(80).optional(),
  message: z.string().max(500).optional(),
  path: z.string().max(500).optional(),
});

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/**
 * Browser crash reports from the app error boundaries, forwarded to the
 * operator alert webhook. The response is always an empty 204 so the endpoint
 * reveals nothing; reports are size-capped, same-origin, and rate limited per
 * IP, and the alert layer redacts and de-duplicates them further.
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return noContent();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return noContent();
  if (!(await checkRateLimitById("clientError", `ip:${getClientIpFromHeaders(request.headers)}`))) return noContent();

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return noContent();
    body = JSON.parse(text);
  } catch {
    return noContent();
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return noContent();

  const { boundary, name, message, path } = parsed.data;
  const error = Object.assign(new Error(message ?? ""), { name: /^[A-Za-z]{1,40}$/.test(name ?? "") ? name! : "Error" });
  error.stack = undefined;
  reportOpsAlert({
    level: "error",
    source: "browser",
    title: boundary === "global" ? "App crashed in the browser" : boundary === "panel" ? "Dashboard section crashed in the browser" : "Page crashed in the browser",
    error,
    context: { page: path ? sanitizeAlertPath(path) : undefined },
  });
  return noContent();
}
