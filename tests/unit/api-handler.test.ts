import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), touch: vi.fn(), limit: vi.fn(), after: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/api/v1/credentials", () => ({ authenticateApiCredential: mocks.authenticate, touchApiCredential: mocks.touch }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimitById: mocks.limit }));

import { handleMachineApiRequest } from "@/lib/api/v1/handler";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(true);
});

describe("machine API request boundary", () => {
  it("returns the same generic authentication error when no credential resolves", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await handleMachineApiRequest(new Request("https://example.test/api/v1/events"), "events:read", vi.fn());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_CREDENTIAL" } });
  });

  it("checks exact scopes and does not call the operation when missing", async () => {
    mocks.authenticate.mockResolvedValue({ apiClientId: "client_1", credentialId: "credential_1", organisationId: "org_1", scopes: new Set(["participants:read"]), lastUsedAt: null });
    const operation = vi.fn();
    const response = await handleMachineApiRequest(new Request("https://example.test/api/v1/events"), "events:read", operation);
    expect(response.status).toBe(403);
    expect(operation).not.toHaveBeenCalled();
  });

  it("uses a stable client-derived rate subject and passes tenant context", async () => {
    const context = { apiClientId: "client_1", credentialId: "credential_1", organisationId: "org_1", scopes: new Set(["events:read"]), lastUsedAt: null };
    mocks.authenticate.mockResolvedValue(context);
    const operation = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const response = await handleMachineApiRequest(new Request("https://example.test/api/v1/events"), "events:read", operation);
    expect(response.status).toBe(204);
    expect(mocks.limit).toHaveBeenCalledWith("apiRead", expect.stringMatching(/^api-client:[a-f0-9]{32}$/));
    expect(operation).toHaveBeenCalledWith(context);
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("uses the same client limit when credentials are rotated", async () => {
    const base = { apiClientId: "client_1", organisationId: "org_1", scopes: new Set(["events:read"]), lastUsedAt: null };
    mocks.authenticate
      .mockResolvedValueOnce({ ...base, credentialId: "credential_old" })
      .mockResolvedValueOnce({ ...base, credentialId: "credential_new" });
    const operation = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const request = new Request("https://example.test/api/v1/events");
    await handleMachineApiRequest(request, "events:read", operation);
    await handleMachineApiRequest(request, "events:read", operation);
    expect(mocks.limit.mock.calls[0]?.[1]).toBe(mocks.limit.mock.calls[1]?.[1]);
  });
});
