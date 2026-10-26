import { logOpsError } from "@/lib/opsAlerts";

/**
 * Auth.js error types that are ordinary outcomes of someone using the sign-in
 * form, not faults of the instance: a wrong password, an unverified email, the
 * password step of a two-step MFA sign-in (all `CredentialsSignin`), a POST
 * without the CSRF token (anyone can send one, signed out), a sign-in our own
 * `signIn` callback declined, or an expired verification link. Auth.js logs
 * every error through `logger.error`, so without this filter each successful
 * MFA sign-in raised an error-level "Sign-in failed" alert.
 */
const EXPECTED_AUTH_ERROR_TYPES: ReadonlySet<string> = new Set(["CredentialsSignin", "MissingCSRF", "AccessDenied", "Verification"]);

export function authErrorType(error: Error): string {
  const { type } = error as Error & { type?: unknown };
  return typeof type === "string" ? type : error.name;
}

/**
 * The Auth.js `logger.error`. Error causes can contain provider responses and
 * credentials, so the log line stays fixed; only the redacted alert carries
 * the detail. Configuration and provider failures (for example
 * `OAuthCallbackError`) still alert.
 */
export function logAuthError(error: Error) {
  const label = authErrorType(error);
  if (EXPECTED_AUTH_ERROR_TYPES.has(label)) return;
  logOpsError("[auth] Authentication failed", { level: "error", source: "auth", title: `Sign-in failed (${label})`, error });
}
