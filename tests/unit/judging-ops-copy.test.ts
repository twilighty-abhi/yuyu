import { describe, expect, it } from "vitest";
import { autoAssignPreviewHeadline, progressTargetLine, signedPoints } from "@/components/event-dashboard/panels/judgingOpsCopy";

describe("judging operations copy", () => {
  it("says whether the target is the default", () => {
    expect(progressTargetLine(3, true)).toBe("Aiming for 3 judges per project (the default; set your own target below).");
    expect(progressTargetLine(1, false)).toBe("Aiming for 1 judge per project.");
  });

  it("signs outlier differences with a real minus", () => {
    expect(signedPoints(12.5)).toBe("+12.5 points");
    expect(signedPoints(-8)).toBe("−8 points");
    expect(signedPoints(1)).toBe("+1 point");
  });

  it("summarises a preview", () => {
    expect(autoAssignPreviewHeadline({ projects: 0, perProject: 3, shortfallTotal: 0, added: 0, removed: 0 })).toBe("There are no submitted projects to assign yet.");
    expect(autoAssignPreviewHeadline({ projects: 10, perProject: 2, shortfallTotal: 0, added: 20, removed: 0 })).toBe(
      "Every one of the 10 submitted projects gets 2 judges. 20 new assignments.",
    );
    expect(autoAssignPreviewHeadline({ projects: 10, perProject: 3, shortfallTotal: 1, added: 0, removed: 4 })).toBe(
      "1 project of 10 can't reach 3 judges: there aren't enough judges without a conflict of interest. No new assignments, 4 assignments removed.",
    );
    expect(autoAssignPreviewHeadline({ projects: 4, perProject: 2, shortfallTotal: 0, added: 5, removed: 0, adopted: 3 })).toBe(
      "Every one of the 4 submitted projects gets 2 judges. 5 new assignments. 3 projects judges have already started become their assignments, so nobody loses work in progress.",
    );
    expect(autoAssignPreviewHeadline({ projects: 4, perProject: 2, shortfallTotal: 0, added: 0, removed: 0, adopted: 1 })).toMatch(/1 project a judge has already started becomes their assignment,/);
  });
});
