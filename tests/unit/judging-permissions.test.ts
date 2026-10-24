import { describe, expect, it } from "vitest";
import { EventPermission } from "@prisma/client";
import { hasNonJudgePermission, judgingPermissionsFor } from "@/lib/judgingPermissions";
import { canSeeGuests, eventPermissionsFor } from "@/lib/mobile/permissions";
import { PERMISSION_OPTIONS, permissionChipLabels } from "@/components/event-dashboard/settings/helpers";

const ALL = Object.values(EventPermission);

describe("JUDGE permission isolation", () => {
  it("a JUDGE-only collaborator can judge and nothing else", () => {
    expect(judgingPermissionsFor(false, false, [EventPermission.JUDGE])).toEqual({ canJudge: true, canManageJudging: false, isJudgeOnly: true });
    // The mobile organiser surface derives every flag without JUDGE.
    const mobile = eventPermissionsFor(false, [EventPermission.JUDGE]);
    expect(Object.values(mobile).every((value) => value === false)).toBe(true);
    expect(canSeeGuests(mobile)).toBe(false);
    expect(hasNonJudgePermission([EventPermission.JUDGE])).toBe(false);
  });

  it("JUDGE never stands in for another permission, and others never imply JUDGE", () => {
    for (const permission of ALL.filter((value) => value !== EventPermission.JUDGE)) {
      expect(judgingPermissionsFor(false, false, [permission])).toEqual({ canJudge: false, canManageJudging: false, isJudgeOnly: false });
      expect(hasNonJudgePermission([permission, EventPermission.JUDGE])).toBe(true);
      const withJudge = eventPermissionsFor(false, [EventPermission.JUDGE, permission]);
      const without = eventPermissionsFor(false, [permission]);
      expect(withJudge).toEqual(without);
    }
  });

  it("is not judge-only with another grant or an organisation membership", () => {
    expect(judgingPermissionsFor(false, false, [EventPermission.JUDGE, EventPermission.CHECK_IN]).isJudgeOnly).toBe(false);
    expect(judgingPermissionsFor(false, true, [EventPermission.JUDGE]).isJudgeOnly).toBe(false);
  });

  it("organisation owners and admins can judge and manage judging", () => {
    expect(judgingPermissionsFor(true, true, [])).toEqual({ canJudge: true, canManageJudging: true, isJudgeOnly: false });
    expect(judgingPermissionsFor(false, true, []).canJudge).toBe(false);
  });

  it("offers Judge in the collaborator invite form", () => {
    expect(PERMISSION_OPTIONS.map((option) => option.value)).toContain("JUDGE");
    expect(permissionChipLabels(["JUDGE"])).toEqual(["Judge"]);
  });
});
