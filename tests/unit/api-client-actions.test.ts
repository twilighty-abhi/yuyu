import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  recent: vi.fn(),
  limited: vi.fn(),
  membership: vi.fn(),
  canManage: vi.fn(),
  orgFind: vi.fn(),
  clientFind: vi.fn(),
  credentialFind: vi.fn(),
  transaction: vi.fn(),
  clientCreate: vi.fn(),
  credentialCreate: vi.fn(),
  credentialUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/reauth", () => ({ hasRecentAuthentication: mocks.recent }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/permissions", () => ({ getMembership: mocks.membership, canManageMembers: mocks.canManage }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const tx = {
  apiClient: { create: mocks.clientCreate, update: vi.fn() },
  apiClientScope: { deleteMany: vi.fn(), createMany: vi.fn() },
  apiCredential: { create: mocks.credentialCreate, update: mocks.credentialUpdate },
  auditEvent: { create: mocks.auditCreate },
};
vi.mock("@/lib/db", () => ({ prisma: {
  organisation: { findUnique: mocks.orgFind },
  apiClient: { findFirst: mocks.clientFind },
  apiCredential: { findFirst: mocks.credentialFind },
  $transaction: mocks.transaction,
} }));

import { createApiClient, revokeApiCredential } from "@/app/actions/api-clients";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
  mocks.recent.mockResolvedValue(true);
  mocks.limited.mockResolvedValue(false);
  mocks.orgFind.mockResolvedValue({ id: "org_1", slug: "tenant" });
  mocks.membership.mockResolvedValue({ role: "OWNER" });
  mocks.canManage.mockReturnValue(true);
  mocks.clientCreate.mockResolvedValue({ id: "client_1" });
  mocks.auditCreate.mockResolvedValue({ id: "audit_1" });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("API client owner actions", () => {
  it("rejects non-owners before creating a machine identity", async () => {
    mocks.canManage.mockReturnValue(false);
    await expect(createApiClient({ organisationSlug: "tenant", name: "Rforum", credentialName: "Primary", scopes: ["events:read"], expiresAt: null }))
      .resolves.toEqual({ ok: false, error: "Only the organisation owner can manage API access." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates a client, hashed credential, scopes, and audit atomically", async () => {
    const result = await createApiClient({ organisationSlug: "tenant", name: "Rforum", credentialName: "Primary", scopes: ["events:read", "participants:read"], expiresAt: null });
    expect(result).toMatchObject({ ok: true, data: { token: expect.stringMatching(/^yuyu_v1_/) } });
    const createInput = mocks.clientCreate.mock.calls[0]![0];
    const credential = createInput.data.credentials.create;
    expect(Buffer.isBuffer(credential.secretHash)).toBe(true);
    expect(credential.secretHash).toHaveLength(32);
    expect(JSON.stringify(createInput)).not.toContain(result.ok ? result.data?.token : "never");
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "API_CLIENT_CREATED", actorUserId: "owner_1", organisationId: "org_1" }) }));
  });

  it("binds credential revocation lookup to the owner's organisation", async () => {
    mocks.credentialFind.mockResolvedValue(null);
    await expect(revokeApiCredential({ organisationSlug: "tenant", apiClientId: "client_1", credentialId: "credential_1" }))
      .resolves.toEqual({ ok: false, error: "Credential not found." });
    expect(mocks.credentialFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ apiClient: { organisationId: "org_1" } }),
    }));
    expect(mocks.credentialUpdate).not.toHaveBeenCalled();
  });
});
