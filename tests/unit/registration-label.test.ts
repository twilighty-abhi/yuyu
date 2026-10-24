import { describe, expect, it } from "vitest";
import { registrationActionLabel } from "@/lib/registrationLabel";

describe("registrationActionLabel", () => {
  const open = { full: false, approvalRequired: false };
  const full = { full: true, approvalRequired: false };
  const approval = { full: false, approvalRequired: true };

  it("keeps the individual wording for non-team events", () => {
    expect(registrationActionLabel(open, null)).toBe("Register — it's free");
    expect(registrationActionLabel(full, null)).toBe("Join the waitlist");
    expect(registrationActionLabel(approval, null)).toBe("Request to join");
  });

  it("says teams only register as teams", () => {
    const team = { soloPolicy: "TEAMS_ONLY" };
    expect(registrationActionLabel(open, team)).toBe("Register your team");
    expect(registrationActionLabel(full, team)).toBe("Join the waitlist with your team");
    expect(registrationActionLabel(approval, team)).toBe("Request a place for your team");
  });

  it("offers teams or solo when solo sign-ups are allowed", () => {
    for (const soloPolicy of ["SOLO_ALLOWED", "SOLO_WITH_MATCHING"]) {
      expect(registrationActionLabel(open, { soloPolicy })).toBe("Register a team or yourself");
      expect(registrationActionLabel(full, { soloPolicy })).toBe("Join the waitlist");
      expect(registrationActionLabel(approval, { soloPolicy })).toBe("Request a place");
    }
  });

  it("prefers the waitlist wording when full and approval-required", () => {
    expect(registrationActionLabel({ full: true, approvalRequired: true }, { soloPolicy: "TEAMS_ONLY" })).toBe("Join the waitlist with your team");
  });
});
