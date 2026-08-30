import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  recent: vi.fn(),
  limited: vi.fn(),
  eventFind: vi.fn(),
  eventUpdate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireOrgRole: mocks.requireRole }));
vi.mock("@/lib/reauth", () => ({ hasRecentAuthentication: mocks.recent }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/checkInStation", () => ({
  createStationPin: () => "12345678",
  hashStationPin: async () => "pin-hash",
  encryptStationPin: () => "v2.encrypted-pin",
  decryptStationPin: () => "12345678",
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const tx = { event: { update: mocks.eventUpdate } };
vi.mock("@/lib/db", () => ({ prisma: {
  event: { findFirst: mocks.eventFind },
  $transaction: mocks.transaction,
} }));

import { createOrRotateCheckInStation } from "@/app/actions/checkin-station";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ organisation: { id: "org_1", slug: "org" }, userId: "admin_1" });
  mocks.recent.mockResolvedValue(true);
  mocks.limited.mockResolvedValue(false);
  mocks.eventFind.mockResolvedValue({ id: "event_1", slug: "event", checkInStationPinEncrypted: null });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("check-in station secret actions", () => {
  it("requires a fresh sign-in before reading or rotating the station secret", async () => {
    mocks.recent.mockResolvedValue(false);
    await expect(createOrRotateCheckInStation({ organisationSlug: "org", eventId: "event_1" }))
      .resolves.toEqual({ ok: false, error: "For security, sign in again before managing the venue station PIN." });
    expect(mocks.eventFind).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("commits PIN rotation and its audit record atomically without auditing plaintext", async () => {
    const result = await createOrRotateCheckInStation({ organisationSlug: "org", eventId: "event_1" });
    expect(result).toEqual({ ok: true, data: { pin: "12345678" } });
    expect(mocks.eventUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ checkInStationPinHash: "pin-hash", checkInStationPinEncrypted: "v2.encrypted-pin" }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ client: tx, action: "CHECK_IN_STATION_PIN_ROTATED" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("12345678");
  });
});
