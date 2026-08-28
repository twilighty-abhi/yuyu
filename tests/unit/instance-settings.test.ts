import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: { instanceSetting: { findUnique } },
}));

import { INSTANCE_SETTINGS_ID, isNewUserRegistrationEnabled } from "@/lib/instanceSettings";

beforeEach(() => vi.clearAllMocks());

describe("instance signup setting", () => {
  it("allows new registrations when no singleton setting exists", async () => {
    findUnique.mockResolvedValue(null);

    await expect(isNewUserRegistrationEnabled()).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { allowNewUserSignups: true },
    });
  });

  it("returns the super-admin configured value", async () => {
    findUnique.mockResolvedValue({ allowNewUserSignups: false });

    await expect(isNewUserRegistrationEnabled()).resolves.toBe(false);
  });
});
