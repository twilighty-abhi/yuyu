import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findCredential: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    apiCredential: { findUnique: mocks.findCredential, updateMany: mocks.updateMany },
  },
}));

import {
  authenticateApiCredential,
  generateApiCredential,
  hashApiSecret,
  parseApiCredential,
} from "@/lib/api/v1/credentials";

beforeEach(() => vi.clearAllMocks());

describe("API credentials", () => {
  it("generates a parseable high-entropy bearer value without embedding the hash", () => {
    const generated = generateApiCredential("cr1234567890abcdef");
    const parsed = parseApiCredential(`Bearer ${generated.token}`);
    expect(parsed).toMatchObject({ credentialId: "cr1234567890abcdef" });
    expect(parsed?.secret).toHaveLength(43);
    expect(generated.secretHash).toEqual(hashApiSecret(parsed!.secret));
    expect(generated.token).not.toContain(generated.secretHash.toString("hex"));
    expect(parseApiCredential(`bearer ${generated.token}`)).toEqual(parsed);
  });

  it.each([null, "", "Basic abc", "Bearer malformed", "Bearer yuyu_v1_bad.short"])(
    "rejects malformed authorization: %s",
    (value) => expect(parseApiCredential(value)).toBeNull(),
  );

  it("authenticates an active, unexpired credential and returns tenant scopes", async () => {
    const secret = "a".repeat(43);
    mocks.findCredential.mockResolvedValue({
      id: "cr1234567890abcdef",
      secretHash: hashApiSecret(secret),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: null,
      apiClient: { id: "client_1", organisationId: "org_1", status: "ACTIVE", scopes: [{ scope: "events:read" }] },
    });
    const context = await authenticateApiCredential(`Bearer yuyu_v1_cr1234567890abcdef.${secret}`);
    expect(context).toMatchObject({ apiClientId: "client_1", credentialId: "cr1234567890abcdef", organisationId: "org_1" });
    expect(context?.scopes.has("events:read")).toBe(true);
  });

  it.each([
    { revokedAt: new Date(), expiresAt: null, status: "ACTIVE" },
    { revokedAt: null, expiresAt: new Date(Date.now() - 60_000), status: "ACTIVE" },
    { revokedAt: null, expiresAt: null, status: "DISABLED" },
  ])("rejects revoked, expired, and disabled credentials", async (state) => {
    const secret = "b".repeat(43);
    mocks.findCredential.mockResolvedValue({
      id: "cr1234567890abcdef",
      secretHash: hashApiSecret(secret),
      revokedAt: state.revokedAt,
      expiresAt: state.expiresAt,
      lastUsedAt: null,
      apiClient: { id: "client_1", organisationId: "org_1", status: state.status, scopes: [] },
    });
    await expect(authenticateApiCredential(`Bearer yuyu_v1_cr1234567890abcdef.${secret}`)).resolves.toBeNull();
  });
});
