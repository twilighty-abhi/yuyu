import { describe, expect, it } from "vitest";
import { SubmissionStatus } from "@prisma/client";
import {
  entrantDisplayName,
  entrantSubmissionView,
  judgeSubmissionDto,
  organiserSubmissionDto,
  personDisplayName,
  publicGalleryItemDto,
  publicWinnerDto,
} from "@/lib/judgingDto";

/** Never in a public, gallery, judge, or entrant DTO. */
const FORBIDDEN = /email|token|answer|checkIn|userId|rsvpId|teamId|attendeeKey|manage|score$|scores|comment|reason|judge(?!d)/i;

function keysDeep(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || value instanceof Date) return [];
  return Object.entries(value).flatMap(([key, child]) => [`${prefix}${key}`, ...keysDeep(child, `${prefix}${key}.`)]);
}

/** A row carrying everything a careless select could load. */
function leakyRow(team: boolean) {
  return {
    id: "sub_1",
    title: "Byte Me",
    summary: "We built a thing.",
    repoUrl: "https://github.com/team/project",
    demoUrl: null,
    videoUrl: "https://video.example.test/1",
    status: SubmissionStatus.SUBMITTED,
    submittedAt: new Date("2030-01-01T00:00:00Z"),
    updatedAt: new Date("2030-01-01T00:00:00Z"),
    disqualifiedReason: "secret organiser note",
    teamId: team ? "team_1" : null,
    rsvpId: team ? null : "rsvp_1",
    team: team ? { name: "Null Pointers", manageTokenHash: "hash", joinToken: "join-secret" } : null,
    rsvp: team ? null : { guestName: "Ada Lovelace", guestEmail: "ada@example.test", checkInToken: "ticket-secret", user: { name: "Ada Lovelace", email: "ada@example.test" } },
    scores: [{ score: 9, judgeUserId: "judge_1" }],
    reviews: [{ comment: "private" }],
  };
}

describe("entrant display names", () => {
  it("uses the team name, or first name and last initial for solo entrants", () => {
    expect(entrantDisplayName({ team: { name: "Null Pointers" }, rsvp: null })).toBe("Null Pointers");
    expect(entrantDisplayName({ team: null, rsvp: { guestName: null, user: { name: "Ada Lovelace" } } })).toBe("Ada L.");
    expect(entrantDisplayName({ team: null, rsvp: { guestName: "Grace", user: null } })).toBe("Grace");
    expect(personDisplayName("  ")).toBe("Participant");
    expect(personDisplayName("<script> Bob")).toBe("script B.");
  });
});

describe("public DTOs", () => {
  it("gallery items carry project content and display names only", () => {
    for (const team of [true, false]) {
      const dto = publicGalleryItemDto(leakyRow(team), [{ name: "Overall", place: 1, score: 99, awardId: "a1" } as { name: string; place: number }]);
      expect(Object.keys(dto).sort()).toEqual(["awards", "demoUrl", "entrantName", "id", "isTeam", "repoUrl", "summary", "title", "videoUrl"]);
      // Award badges carry the name and place only, whatever the row had.
      expect(dto.awards).toEqual([{ name: "Overall", place: 1 }]);
      expect(keysDeep(dto).filter((key) => FORBIDDEN.test(key))).toEqual([]);
      const serialized = JSON.stringify(dto);
      for (const secret of ["ada@example.test", "ticket-secret", "join-secret", "hash", "secret organiser note", "private", "Lovelace"]) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it("winners never include scores, comments, or summaries", () => {
    const dto = publicWinnerDto({ place: 1, submission: leakyRow(false) });
    expect(Object.keys(dto).sort()).toEqual(["demoUrl", "entrantName", "isTeam", "place", "repoUrl", "title", "videoUrl"]);
    expect(dto.entrantName).toBe("Ada L.");
    expect(JSON.stringify(dto)).not.toMatch(/ada@example|ticket-secret|private|"score"/);
  });
});

describe("judge DTO", () => {
  it("shows project content and the judge's own progress, never entrant contacts", () => {
    const dto = judgeSubmissionDto(leakyRow(false), { scoredCriteria: 2, reviewSubmitted: false });
    expect(Object.keys(dto).sort()).toEqual(["demoUrl", "entrantName", "id", "isTeam", "repoUrl", "reviewSubmitted", "scoredCriteria", "summary", "title", "videoUrl"]);
    expect(JSON.stringify(dto)).not.toMatch(/ada@example|ticket-secret|secret organiser note|rsvp_1|team_1/);
  });
});

describe("entrant DTO", () => {
  it("never includes the disqualification reason", () => {
    const view = entrantSubmissionView({ ...leakyRow(true), status: SubmissionStatus.DISQUALIFIED });
    expect(view && Object.keys(view).sort()).toEqual(["demoUrl", "repoUrl", "status", "submittedAt", "summary", "title", "videoUrl"]);
    expect(JSON.stringify(view)).not.toContain("secret organiser note");
    expect(entrantSubmissionView(null)).toBeNull();
  });
});

describe("organiser DTO", () => {
  it("adds status and reason but still no entrant emails or tickets", () => {
    const dto = organiserSubmissionDto(leakyRow(false), ["judge_1"]);
    expect(dto.disqualifiedReason).toBe("secret organiser note");
    expect(dto.assignedJudgeIds).toEqual(["judge_1"]);
    expect(JSON.stringify(dto)).not.toMatch(/ada@example|ticket-secret|rsvp_1/);
  });
});
