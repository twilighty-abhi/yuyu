import { describe, expect, it } from "vitest";
import {
  A6_LANDSCAPE,
  A6_PORTRAIT,
  normalizeIdCardPrintSettings,
} from "@/lib/idCardPrint";

describe("ID card print settings", () => {
  it("defaults to A6 portrait and the event title", () => {
    expect(normalizeIdCardPrintSettings(null, "Open House")).toMatchObject({
      ...A6_PORTRAIT,
      heading: "Open House",
      badgeLabel: "ATTENDEE",
      showEmail: true,
      template: "classic",
      footerText: "Event check-in",
      showLogo: true,
      printFieldKeys: [],
      printFieldLabels: {},
      elementPositions: {
        header: { xMm: 9, yMm: 9 },
        qr: { xMm: 73, yMm: 116 },
      },
    });
  });

  it("keeps valid customisation while bounding paper dimensions", () => {
    expect(normalizeIdCardPrintSettings({
      ...A6_LANDSCAPE,
      heading: "  Welcome  ",
      badgeLabel: "Speaker",
      showEmail: false,
      template: "bold",
      footerText: "Door team",
      showLogo: false,
      printFieldKeys: ["registration:role", "registration:food"],
      printFieldLabels: { "registration:role": "Event role" },
      elementPositions: {
        name: { xMm: 15, yMm: 20 },
        qr: { xMm: 999, yMm: -1 },
      },
      elementSizes: { name: 70, qr: 30 },
      elementBold: { name: false },
    }, "Open House")).toMatchObject({
      ...A6_LANDSCAPE,
      heading: "Welcome",
      badgeLabel: "Speaker",
      showEmail: false,
      template: "bold",
      footerText: "Door team",
      showLogo: false,
      printFieldKeys: ["registration:role", "registration:food"],
      printFieldLabels: { "registration:role": "Event role" },
      elementPositions: {
        name: { xMm: 15, yMm: 20 },
        qr: { xMm: 114, yMm: 0 },
      },
      elementSizes: { name: 70, qr: 30 },
      elementBold: { name: false },
    });
    expect(normalizeIdCardPrintSettings({ widthMm: 2, heightMm: 1000 }, "Open House")).toMatchObject({
      widthMm: 40,
      heightMm: 300,
    });
    expect(normalizeIdCardPrintSettings({ printFieldKeys: ["system:organisation-name"] }, "Open House")).toMatchObject({
      printFieldKeys: [],
    });
    expect(normalizeIdCardPrintSettings({ printFieldLabels: { "registration:role": "   " } }, "Open House")).toMatchObject({
      printFieldLabels: { "registration:role": "" },
    });
  });
});
