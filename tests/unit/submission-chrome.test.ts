import { describe, expect, it } from "vitest";
import { chromeFor } from "@/components/chrome/ChromeSwitch";

describe("chromeFor on entrant capability pages", () => {
  it("gives the solo submission link and the team page Yuyu's site chrome (header, main landmark, page gutter)", () => {
    // /submit/{token} renders no chrome of its own (docs/HACKATHON.md).
    expect(chromeFor("/submit/abc")).toBe("site");
    expect(chromeFor("/team/abc")).toBe("site");
    expect(chromeFor("/ticket/abc")).toBe("site");
  });

  it("leaves the signed-in submission page to the account layout", () => {
    expect(chromeFor("/account/submissions/evt")).toBe("own");
    expect(chromeFor("/submit")).toBe("own");
  });
});
