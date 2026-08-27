import "server-only";

import crypto from "node:crypto";
import { after } from "next/server";
import { checkRateLimitById } from "@/lib/rateLimit";
import { apiError } from "@/lib/api/v1/errors";
import {
  authenticateApiCredential,
  touchApiCredential,
  type ApiAuthContext,
} from "@/lib/api/v1/credentials";
import type { ApiScope } from "@/lib/api/v1/scopes";

function clientRateLimitKey(apiClientId: string) {
  const subject = crypto.createHash("sha256").update(apiClientId).digest("hex").slice(0, 32);
  return `api-client:${subject}`;
}

export async function handleMachineApiRequest(
  request: Request,
  requiredScope: ApiScope,
  operation: (context: ApiAuthContext) => Promise<Response>,
) {
  const context = await authenticateApiCredential(request.headers.get("authorization"));
  if (!context) return apiError("INVALID_CREDENTIAL", 401);

  if (!context.scopes.has(requiredScope)) {
    return apiError("INSUFFICIENT_SCOPE", 403);
  }

  const allowed = await checkRateLimitById("apiRead", clientRateLimitKey(context.apiClientId));
  if (!allowed) return apiError("RATE_LIMITED", 429, { retryAfter: 60 });

  after(async () => {
    try {
      await touchApiCredential(context.credentialId, context.lastUsedAt);
    } catch {
      // Usage tracking is best-effort and must never change authentication.
    }
  });

  return operation(context);
}
