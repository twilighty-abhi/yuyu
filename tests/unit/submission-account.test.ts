import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { buildAccountDataExport, type AccountExportSource } from "@/lib/accountDataExport";
import { submissionHref } from "@/lib/accountRegistrations";

const project = {
  title: "Pocket Engine",
  summary: "A difference engine you can carry.",
  repoUrl: "https://example.test/repo",
  demoUrl: null,
  videoUrl: null,
  status: "DISQUALIFIED",
  submittedAt: new Date("2030-03-01T12:00:00Z"),
  createdAt: new Date("2030-03-01T10:00:00Z"),
  updatedAt: new Date("2030-03-01T12:00:00Z"),
  // As if a loader over-selected: organiser-only and internal columns.
  disqualifiedReason: "organiser-only reason",
  id: "submission-internal-id",
  rsvpId: "rsvp-internal-id",
};

const event = { title: "Engines Jam", startDateTime: new Date("2030-03-01T09:00:00Z"), endDateTime: new Date("2030-03-01T18:00:00Z"), timezone: "Europe/London", organisation: { name: "Analytical Society" } };

function source(registrations: unknown[]): AccountExportSource {
  return {
    user: { name: "Ada", email: "ada@example.test", emailVerified: null, createdAt: new Date("2030-01-01T00:00:00Z"), mfaEnabledAt: null },
    signInProviders: [],
    memberships: [],
    registrations,
    feedback: [],
    collaborations: [],
  } as unknown as AccountExportSource;
}

const base = { status: "CONFIRMED", createdAt: new Date("2030-02-01T00:00:00Z"), checkedInAt: null, event, eventInstance: null, answers: [] };

describe("personal data export: submissions", () => {
  it("includes a solo registrant's own project without the disqualification reason", () => {
    const data = buildAccountDataExport(source([{ ...base, id: "rsvp_1", team: null, submission: project }]));
    expect(data.submissions).toEqual([{
      event: "Engines Jam",
      organisation: "Analytical Society",
      team: null,
      title: "Pocket Engine",
      summary: "A difference engine you can carry.",
      repoUrl: "https://example.test/repo",
      demoUrl: null,
      videoUrl: null,
      status: "DISQUALIFIED",
      submittedAt: "2030-03-01T12:00:00.000Z",
      createdAt: "2030-03-01T10:00:00.000Z",
      updatedAt: "2030-03-01T12:00:00.000Z",
    }]);
    const json = JSON.stringify(data);
    expect(json).not.toContain("organiser-only reason");
    expect(json).not.toContain("submission-internal-id");
    expect(json).not.toContain("rsvp-internal-id");
  });

  it("includes the team's project for a team member, named by team", () => {
    const data = buildAccountDataExport(source([{ ...base, id: "rsvp_2", team: { name: "Night Owls", leaderRsvpId: "rsvp_9", submission: { ...project, status: "SUBMITTED" } }, submission: null }]));
    expect(data.submissions).toHaveLength(1);
    expect(data.submissions[0]).toMatchObject({ team: "Night Owls", title: "Pocket Engine", status: "SUBMITTED" });
  });

  it("is empty for registrations without a project", () => {
    expect(buildAccountDataExport(source([{ ...base, id: "rsvp_3", team: null }])).submissions).toEqual([]);
  });
});

describe("Account → Registrations project link", () => {
  const live = { id: "event_1", status: "PUBLISHED" as const, page: { isPublished: true } };

  it("links the signed-in project page only for events taking submissions", () => {
    expect(submissionHref({ status: "CONFIRMED", event: { ...live, submissionsEnabled: true } })).toBe("/account/submissions/event_1");
    expect(submissionHref({ status: "WAITLISTED", event: { ...live, submissionsEnabled: true } })).toBe("/account/submissions/event_1");
    expect(submissionHref({ status: "REJECTED", event: { ...live, submissionsEnabled: true } })).toBeNull();
    expect(submissionHref({ status: "CONFIRMED", event: { ...live, submissionsEnabled: false } })).toBeNull();
    expect(submissionHref({ status: "CONFIRMED", event: null })).toBeNull();
    // Same publication rule as the page: no link for a draft, hidden, or cancelled event, or an unreleased website.
    for (const status of ["DRAFT", "HIDDEN", "CANCELLED"] as const) {
      expect(submissionHref({ status: "CONFIRMED", event: { ...live, status, submissionsEnabled: true } })).toBeNull();
    }
    expect(submissionHref({ status: "CONFIRMED", event: { ...live, page: { isPublished: false }, submissionsEnabled: true } })).toBeNull();
  });
});
