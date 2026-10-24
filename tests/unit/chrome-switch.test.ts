import { describe, expect, it } from "vitest";
import { chromeFor } from "@/components/chrome/ChromeSwitch";

describe("chromeFor", () => {
  it("gives the bearer capability pages Yuyu's site chrome (header, main landmark and page gutter)", () => {
    expect(chromeFor("/ticket/abc")).toBe("site");
    // The team management page renders no chrome of its own (docs/TEAMS.md).
    expect(chromeFor("/team/abc")).toBe("site");
  });

  it("leaves organiser-context and app pages to their own layouts", () => {
    expect(chromeFor("/smoke-org/hack/team/abc")).toBe("own");
    expect(chromeFor("/account/teams/abc")).toBe("own");
    expect(chromeFor("/dashboard/org")).toBe("own");
    expect(chromeFor("/teams")).toBe("own");
  });
});
