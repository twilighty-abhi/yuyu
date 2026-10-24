import { NextResponse } from "next/server";
import type { ZodError, ZodType } from "zod";

/*
 * Response envelope for /api/mobile/v1 (Yuyu mobile apps, Android and iOS).
 * Success: { ok: true, data }. Failure: { ok: false, error: { code, message,
 * fieldErrors? } }. Every response is `no-store`.
 */

export type MobileErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "MFA_REQUIRED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NEEDS_FORCE"
  | "RATE_LIMITED"
  | "TEAM_REQUIRED"
  | "INTERNAL_ERROR";

export const MOBILE_ERROR_STATUS: Record<MobileErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 401,
  EMAIL_VERIFICATION_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NEEDS_FORCE: 409,
  RATE_LIMITED: 429,
  TEAM_REQUIRED: 409,
  INTERNAL_ERROR: 500,
};

const DEFAULT_MESSAGES: Record<MobileErrorCode, string> = {
  INVALID_REQUEST: "The request is invalid.",
  UNAUTHENTICATED: "Sign in again to continue.",
  MFA_REQUIRED: "Enter the code from your authenticator app.",
  EMAIL_VERIFICATION_REQUIRED: "Verify your email address before signing in.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "Not found.",
  CONFLICT: "That change could not be made.",
  NEEDS_FORCE: "This guest needs a staff override to check in.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  TEAM_REQUIRED: "This event registers teams only. Register on the event website to create or join a team.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function mobileOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: NO_STORE });
}

export function mobileError(
  code: MobileErrorCode,
  message?: string,
  options: { fieldErrors?: Record<string, string[]>; retryAfter?: number } = {},
) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (code === "UNAUTHENTICATED") headers["WWW-Authenticate"] = 'Bearer realm="Yuyu mobile"';
  if (code === "RATE_LIMITED") headers["Retry-After"] = String(options.retryAfter ?? 60);
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message: message ?? DEFAULT_MESSAGES[code],
        ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
      },
    },
    { status: MOBILE_ERROR_STATUS[code], headers },
  );
}

export const unauthenticated = () => mobileError("UNAUTHENTICATED");
export const notFound = () => mobileError("NOT_FOUND");

type FailedActionResult = { ok: false; error: string; fieldErrors?: Record<string, string[]>; needsForce?: boolean; code?: "TEAM_REQUIRED" };

/**
 * Map a Server Action failure (UI-safe message) to a mobile error code. The
 * message is passed through unchanged; only the classification is added.
 */
export function classifyActionError(result: FailedActionResult): MobileErrorCode {
  const message = result.error;
  if (result.needsForce) return "NEEDS_FORCE";
  if (result.code === "TEAM_REQUIRED") return "TEAM_REQUIRED";
  if (/^You must be signed in/i.test(message)) return "UNAUTHENTICATED";
  if (/^Too many/i.test(message)) return "RATE_LIMITED";
  if (result.fieldErrors) return "INVALID_REQUEST";
  if (/not found\.?$|no longer exists|is not for this event|No matching ticket|^Invalid registration/i.test(message)) return "NOT_FOUND";
  if (/permission|^Only owners and admins|can only cancel your own|^Verify your own email/i.test(message)) return "FORBIDDEN";
  if (/^Invalid|^Check the|^Missing|^Choose|is required|^Enter |^Could not read|^The message is empty/i.test(message)) return "INVALID_REQUEST";
  if (/^Could not (queue|save|restore|update)|could not be completed/i.test(message)) return "INTERNAL_ERROR";
  return "CONFLICT";
}

export function mobileActionError(result: FailedActionResult) {
  const code = classifyActionError(result);
  return mobileError(code, result.error, result.fieldErrors ? { fieldErrors: result.fieldErrors } : {});
}

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    (out[path] ??= []).push(issue.message);
  }
  return out;
}

const MAX_BODY_BYTES = 256 * 1024;

/** Read a bounded JSON body. Returns `{ value }` or a ready error response. */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<{ value: unknown } | { response: Response }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { response: mobileError("INVALID_REQUEST", "Request is too large.") };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { response: mobileError("INVALID_REQUEST", "Invalid request body.") };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { response: mobileError("INVALID_REQUEST", "Request is too large.") };
  if (!text.trim()) return { value: {} };
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { response: mobileError("INVALID_REQUEST", "Invalid JSON.") };
  }
}

/** Parse a JSON body against a schema, producing an INVALID_REQUEST with field errors on failure. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<{ data: T } | { response: Response }> {
  const body = await readJsonBody(request);
  if ("response" in body) return body;
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return { response: mobileError("INVALID_REQUEST", undefined, { fieldErrors: zodFieldErrors(parsed.error) }) };
  return { data: parsed.data };
}

export function parseQuery<T>(request: Request, schema: ZodType<T>): { data: T } | { response: Response } {
  const raw = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { response: mobileError("INVALID_REQUEST", undefined, { fieldErrors: zodFieldErrors(parsed.error) }) };
  return { data: parsed.data };
}
