import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CREDENTIAL"
  | "INSUFFICIENT_SCOPE"
  | "RESOURCE_NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const messages: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: "The request is invalid.",
  INVALID_CREDENTIAL: "A valid API credential is required.",
  INSUFFICIENT_SCOPE: "The API client does not have the required scope.",
  RESOURCE_NOT_FOUND: "The requested resource was not found.",
  RATE_LIMITED: "Too many requests. Try again later.",
  INTERNAL_ERROR: "The request could not be completed.",
};

export function apiError(
  code: ApiErrorCode,
  status: number,
  options?: { retryAfter?: number },
) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 401) headers["WWW-Authenticate"] = 'Bearer realm="Yuyu API"';
  if (options?.retryAfter) headers["Retry-After"] = String(options.retryAfter);
  return NextResponse.json(
    { error: { code, message: messages[code] } },
    { status, headers },
  );
}
