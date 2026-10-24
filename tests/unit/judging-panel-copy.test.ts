import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/feedback/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/app/actions/judging-admin", () => ({
  saveJudgingSettings: vi.fn(),
  changeJudgingStatus: vi.fn(),
  publishJudgingResults: vi.fn(),
  unpublishJudgingResults: vi.fn(),
}));
vi.mock("@/app/actions/judging", () => ({ loadJudgeSubmission: vi.fn(), saveJudgeReviewAction: vi.fn() }));

import { JudgingPanelJudges, JudgingPanelResults } from "@/components/event-dashboard/panels/JudgingPanelResults";
import { JudgingSettingsCard, judgingSettingsSavedMessage } from "@/components/event-dashboard/panels/JudgingPanelSetup";
import {
  awardsHeldBy,
  disqualifyImpact,
  eventNotLiveWarning,
  ordinal,
  reinstateImpact,
  resultsPublishHint,
} from "@/components/event-dashboard/panels/judgingCopy";
import { JudgeWorkspaceClient } from "@/components/event-dashboard/judging/JudgeWorkspaceClient";
import { judgingStatusNotice, noRubricNotice } from "@/components/event-dashboard/judging/judgeProgress";
import { windowPhase, windowText } from "@/components/submission/submissionWindow";
import { activeTabScrollTarget } from "@/components/ui/tabs";
import type { JudgingDashboardJudge, JudgingDashboardSettings } from "@/lib/eventDashboard/judging";
import { zonedIsoWithOffset } from "@/lib/timeZone";

const scope = { organisationSlug: "org", eventId: "event_1" };
// renderToString escapes apostrophes; compare against plain text.
const text = (html: string) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function settings(overrides: Partial<JudgingDashboardSettings> = {}): JudgingDashboardSettings {
  return {
    submissionsEnabled: true,
    opensAtLocal: "2026-10-25T09:00",
    closesAtLocal: "2026-10-26T09:00",
    opensAt: "2026-10-25T03:30:00.000Z",
    closesAt: "2026-10-26T03:30:00.000Z",
    judgingStatus: "NOT_STARTED",
    judgesSeeAll: true,
    projectGalleryPublic: false,
    resultsPublishedAt: null,
    timezone: "Asia/Kolkata",
    eventStatus: "PUBLISHED",
    ...overrides,
  };
}

describe("submissions on an event that isn't live (1)", () => {
  it("warns organisers for draft, offline and cancelled events only", () => {
    expect(eventNotLiveWarning("PUBLISHED")).toBeNull();
    expect(eventNotLiveWarning("DRAFT")?.body).toMatch(/until you publish the event/);
    expect(eventNotLiveWarning("HIDDEN")?.title).toMatch(/offline/);
    expect(eventNotLiveWarning("CANCELLED")?.title).toMatch(/cancelled/);
  });

  it("shows the warning on the settings card while the switch is on and the event is a draft", () => {
    const draft = text(renderToString(createElement(JudgingSettingsCard, { scope, settings: settings({ eventStatus: "DRAFT" }), now: "2026-10-25T00:00:00.000Z" })));
    expect(draft).toContain("This event is still a draft.");
    expect(draft).toContain("Go to Overview");
    const live = text(renderToString(createElement(JudgingSettingsCard, { scope, settings: settings(), now: "2026-10-25T00:00:00.000Z" })));
    expect(live).not.toContain("still a draft");
    // Switch off: nothing to warn about yet.
    const off = text(renderToString(createElement(JudgingSettingsCard, { scope, settings: settings({ eventStatus: "DRAFT", submissionsEnabled: false }), now: "2026-10-25T00:00:00.000Z" })));
    expect(off).not.toContain("still a draft");
  });

  it("repeats it in the save toast", () => {
    expect(judgingSettingsSavedMessage(true, false, false)).toMatch(/Entrants can't submit until the event is published\.$/);
    expect(judgingSettingsSavedMessage(true, true, true)).not.toMatch(/published/);
    expect(judgingSettingsSavedMessage(false, false, false)).toBe("Judging settings saved.");
  });

  it("gives entrants an accurate window line", () => {
    const opensAt = new Date("2026-10-25T00:00:00Z");
    const closesAt = new Date("2026-10-26T00:00:00Z");
    const inside = new Date("2026-10-25T12:00:00Z");
    expect(windowPhase({ opensAt, closesAt, isOpen: true }, inside)).toBe("open");
    expect(windowPhase({ opensAt, closesAt, isOpen: false }, inside)).toBe("not-live");
    expect(windowPhase({ opensAt: null, closesAt: null, isOpen: false }, inside)).toBe("unscheduled");
    expect(windowText({ phase: "not-live", opensLabel: null, closesLabel: null })).toBe("Submissions open once the organisers publish the event.");
    expect(windowText({ phase: "unscheduled", opensLabel: null, closesLabel: null })).toBe("The organisers haven't set the submission dates yet.");
    expect(windowText({ phase: "unscheduled", opensLabel: null, closesLabel: null })).not.toMatch(/right now/);
  });
});

describe("Results publish hint (2)", () => {
  it("matches the judging status", () => {
    expect(resultsPublishHint("NOT_STARTED")).toMatch(/^Judging hasn't started\. Open judging/);
    expect(resultsPublishHint("OPEN")).toMatch(/Close judging on the Setup tab to finalise/);
    expect(resultsPublishHint("CLOSED")).toMatch(/publish the results/);
    expect(resultsPublishHint("CLOSED")).not.toMatch(/Close judging/);
  });

  it("renders the not-started hint on the Results tab", () => {
    const html = text(
      renderToString(
        createElement(JudgingPanelResults, {
          scope,
          rows: [],
          criteria: [],
          judgingStatus: "NOT_STARTED",
          resultsPublishedAt: null,
          resultsUrl: "https://yuyu.example/org/hack/results",
          exportHref: "/api/exports/events/event_1/judging",
          timezone: "UTC",
        }),
      ),
    );
    expect(html).toContain("Open judging on the Setup tab");
    expect(html).not.toContain("Close judging on the Setup tab before");
  });
});

describe("Score tab copy for organisers (3)", () => {
  it("speaks to organisers as organisers", () => {
    expect(noRubricNotice("judge").body).toMatch(/The organisers have not added/);
    expect(noRubricNotice("organiser").body).not.toMatch(/The organisers/);
    expect(judgingStatusNotice("NOT_STARTED", "organiser")?.body).toMatch(/Open judging on the Setup tab/);
    expect(judgingStatusNotice("NOT_STARTED")?.body).toMatch(/when the organisers start judging/);
  });

  it("links organisers to the rubric editor and keeps judges' copy", () => {
    const base = { ...scope, judgingStatus: "NOT_STARTED" as const, criteria: [], submissions: [] };
    const organiser = text(renderToString(createElement(JudgeWorkspaceClient, { ...base, audience: "organiser" })));
    expect(organiser).toContain("Edit the rubric");
    expect(organiser).not.toContain("The organisers have not added");
    const judge = text(renderToString(createElement(JudgeWorkspaceClient, base)));
    expect(judge).toContain("The organisers have not added judging criteria");
    expect(judge).not.toContain("Edit the rubric");
  });
});

describe("Judges tab (4)", () => {
  const admin: JudgingDashboardJudge = { userId: "u1", name: "Olive Owner", email: "olive@example.test", kind: "admin", visible: null, reviewsSubmitted: 0, assigned: 0 };
  const judge: JudgingDashboardJudge = { userId: "u2", name: "Jules Judge", email: "jules@example.test", kind: "judge", visible: 3, reviewsSubmitted: 1, assigned: 0 };

  it("shows the empty state for invited judges even when organisers can judge", () => {
    const html = text(renderToString(createElement(JudgingPanelJudges, { judges: [admin], judgesSeeAll: true })));
    expect(html).toContain("No judges invited yet");
    expect(html).toContain("Organisers who can also judge");
    expect(html).toContain("Olive Owner");
  });

  it("lists invited judges apart from organisers", () => {
    const html = text(renderToString(createElement(JudgingPanelJudges, { judges: [admin, judge], judgesSeeAll: true })));
    expect(html).not.toContain("No judges invited yet");
    const invited = html.indexOf("Invited judges");
    const organisers = html.indexOf("Organisers who can also judge");
    expect(invited).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Jules Judge")).toBeGreaterThan(invited);
    expect(html.indexOf("Jules Judge")).toBeLessThan(organisers);
    expect(html.indexOf("Olive Owner")).toBeGreaterThan(organisers);
  });
});

describe("active tab scrolled into view (5)", () => {
  const row = { scrollLeft: 0, clientWidth: 360, scrollWidth: 900 };

  it("leaves a visible tab alone", () => {
    expect(activeTabScrollTarget(row, { left: 0, width: 90 })).toBeNull();
    expect(activeTabScrollTarget({ ...row, scrollWidth: 360 }, { left: 200, width: 90 })).toBeNull();
  });

  it("scrolls forward to an off-screen tab, clear of the scroll hint", () => {
    // Tab at 700..790: its right edge plus the 56px hint margin lines up with the row's right edge.
    expect(activeTabScrollTarget(row, { left: 700, width: 90 })).toBe(700 + 90 + 56 - 360);
    // The last tab needs no margin after it, and never scrolls past the end.
    expect(activeTabScrollTarget(row, { left: 810, width: 90 })).toBe(540);
  });

  it("scrolls back to a tab hidden on the left", () => {
    expect(activeTabScrollTarget({ ...row, scrollLeft: 500 }, { left: 300, width: 90 })).toBe(300 - 56);
    expect(activeTabScrollTarget({ ...row, scrollLeft: 500 }, { left: 0, width: 90 })).toBe(0);
  });

  it("takes a smaller margin for rows without hints", () => {
    expect(activeTabScrollTarget(row, { left: 700, width: 90 }, 16)).toBe(700 + 90 + 16 - 360);
  });
});

describe("disqualifying and reinstating (6)", () => {
  const awards = [
    { name: "Overall winner", winners: [{ place: 1, submissionId: "s1" }, { place: 2, submissionId: "s2" }] },
    { name: "Best design", winners: [{ place: 1, submissionId: "s1" }] },
  ];

  it("lists the awards a project holds", () => {
    expect(awardsHeldBy(awards, "s1")).toEqual(["Overall winner (1st place)", "Best design (1st place)"]);
    expect(awardsHeldBy(awards, "s3")).toEqual([]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });

  it("warns that published results change and lost awards aren't given back", () => {
    const published = disqualifyImpact({ title: "Robo", awardsHeld: awardsHeldBy(awards, "s1"), resultsPublished: true });
    expect(published).toContain("Overall winner (1st place), Best design (1st place)");
    expect(published).toMatch(/live results page changes straight away/);
    expect(published).toMatch(/doesn't give the awards back/);
    const unpublished = disqualifyImpact({ title: "Robo", awardsHeld: [], resultsPublished: false });
    expect(unpublished).not.toMatch(/live results/);
    expect(unpublished).toMatch(/You can reinstate it later\.$/);
  });

  it("says reinstating doesn't restore awards", () => {
    expect(reinstateImpact({ title: "Robo", resultsPublished: false })).toMatch(/Awards it lost when it was disqualified aren't given back/);
    expect(reinstateImpact({ title: "Robo", resultsPublished: true })).toMatch(/live results page doesn't change until you do/);
  });
});

describe("judging CSV timestamps (7)", () => {
  const instant = new Date("2026-10-25T09:00:05.750Z");

  it("writes ISO 8601 in the event timezone with an explicit offset", () => {
    expect(zonedIsoWithOffset(instant, "Asia/Kolkata")).toBe("2026-10-25T14:30:05+05:30");
    expect(zonedIsoWithOffset(instant, "UTC")).toBe("2026-10-25T09:00:05+00:00");
    expect(zonedIsoWithOffset(instant, "America/New_York")).toBe("2026-10-25T05:00:05-04:00");
    // Still the same instant (to the second) when parsed back.
    expect(new Date(zonedIsoWithOffset(instant, "Asia/Kolkata")).getTime()).toBe(Math.floor(instant.getTime() / 1000) * 1000);
  });

  it("handles DST changes and invalid dates", () => {
    expect(zonedIsoWithOffset(new Date("2026-03-29T00:59:59Z"), "Europe/London")).toBe("2026-03-29T00:59:59+00:00");
    expect(zonedIsoWithOffset(new Date("2026-03-29T01:00:00Z"), "Europe/London")).toBe("2026-03-29T02:00:00+01:00");
    expect(zonedIsoWithOffset(new Date("nope"), "UTC")).toBe("");
  });
});
