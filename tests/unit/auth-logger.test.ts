import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDenied, CallbackRouteError, CredentialsSignin, MissingCSRF, OAuthCallbackError } from "@auth/core/errors";

const mocks = vi.hoisted(() => ({ logOpsError: vi.fn() }));
vi.mock("@/lib/opsAlerts", () => ({ logOpsError: mocks.logOpsError }));

import { logAuthError } from "@/lib/authLogger";

/** The password step of a two-step MFA sign-in throws this (lib/auth.ts). */
class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}

describe("Auth.js error logging", () => {
  beforeEach(() => mocks.logOpsError.mockReset());

  it("does not alert on the MFA password step, a wrong password, a missing CSRF token, or a declined sign-in", () => {
    for (const error of [new MfaRequiredError(), new CredentialsSignin(), new MissingCSRF("no token"), new AccessDenied("declined")]) {
      logAuthError(error);
    }
    expect(mocks.logOpsError).not.toHaveBeenCalled();
  });

  it("still alerts on provider and configuration failures, with the error type in the title", () => {
    logAuthError(new OAuthCallbackError("bad state"));
    logAuthError(new CallbackRouteError("adapter down"));
    logAuthError(new Error("unexpected"));
    expect(mocks.logOpsError.mock.calls.map(([, details]) => details.title)).toEqual([
      "Sign-in failed (OAuthCallbackError)",
      "Sign-in failed (CallbackRouteError)",
      "Sign-in failed (Error)",
    ]);
    expect(mocks.logOpsError.mock.calls.every(([message, details]) => message === "[auth] Authentication failed" && details.level === "error" && details.source === "auth")).toBe(true);
  });
});
