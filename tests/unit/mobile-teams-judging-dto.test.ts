import { describe, expect, it } from "vitest";
import { myReviewStatus, toGuest, toJudgeSubmission, toMyTeam, toOrganiserTeam } from "@/lib/mobile/dto";
import { lookupRowToGuest, toCheckInResult } from "@/lib/mobile/checkIn";
import { classifyActionError } from "@/lib/mobile/http";
import {
  guestSchema,
  judgeSubmissionDetailDtoSchema,
  judgeSubmissionSchema,
  myTeamSchema,
  organiserTeamSchema,
  registrationDtoSchema,
} from "@/lib/mobile/schemas";

/*
 * Forbidden-field tests for the mobile team and judging DTOs
 * (docs/MOBILE_API.md): attendee team views carry display names only, the
 * organiser team list no emails, and judge views never entrant emails,
 * answers, ticket tokens, disqualification reasons or other judges' scores.
 */

const SECRETS = ["ada@example.test", "grace@example.test", "tkSECRETticket", "manageHASH", "joinTOKEN", "Lovelace", "Disqualified for plagiarism", "otherJudgeScore"];

function expectNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of SECRETS) expect(serialized).not.toContain(secret);
}

describe("mobile team DTOs", () => {
  it("shows an attendee's team as display names only, with their own role", () => {
    const team = {
      id: "t1",
      name: "Byte Club",
      leaderRsvpId: "r1",
      maxSize: 4,
      joinToken: "joinTOKEN",
      manageTokenHash: "manageHASH",
      members: [
        { id: "r1", guestName: null, user: { name: "Ada Lovelace", email: "ada@example.test" }, checkInToken: "tkSECRETticket" },
        { id: "r2", guestName: "Grace", guestEmail: "grace@example.test", user: null },
      ],
    };
    const leader = toMyTeam(team, "r1");
    expect(leader).toEqual({
      id: "t1", name: "Byte Club", role: "LEADER", size: 2, maxSize: 4,
      members: [{ displayName: "Ada L.", isLeader: true }, { displayName: "Grace", isLeader: false }],
    });
    expect(toMyTeam(team, "r2").role).toBe("MEMBER");
    expectNoSecrets(leader);
    expect(myTeamSchema.safeParse({ ...leader, joinToken: "x" }).success).toBe(false);
    expect(myTeamSchema.safeParse({ ...leader, members: [{ displayName: "A", isLeader: true, email: "a@b.c" }] }).success).toBe(false);
  });

  it("lets a registration carry a team but nothing else extra", () => {
    const base = {
      rsvpId: "r1", status: "CONFIRMED", checkedInAt: null, registeredAt: new Date().toISOString(), canCancel: true, ticketToken: null, instanceId: null,
      event: {
        id: "e1", slug: "e", title: "E", coverImageUrl: null, startDateTime: new Date().toISOString(), endDateTime: new Date().toISOString(), timezone: "UTC",
        location: "", mapLinkUrl: null, isOnline: false, accentColor: null, status: "PUBLISHED", registrationMode: "TEAM",
        organisation: { slug: "o", name: "O", logoUrl: null },
      },
    };
    expect(registrationDtoSchema.safeParse(base).success).toBe(true);
    expect(registrationDtoSchema.safeParse({ ...base, team: { id: "t", name: "T", role: "MEMBER", size: 1, maxSize: null, members: [] } }).success).toBe(true);
    expect(registrationDtoSchema.safeParse({ ...base, teamManageToken: "x" }).success).toBe(false);
  });

  it("maps organiser teams without member emails", () => {
    const dto = toOrganiserTeam({
      id: "t1", name: "Byte Club", status: "PENDING_APPROVAL", size: 1, minSize: 2, maxSize: 4, incomplete: true, lookingForMembers: false,
      createdAt: new Date(), leaderRsvpId: "r1",
      members: [{ rsvpId: "r1", name: "Margaret Hamilton", email: "ada@example.test", isLeader: true, checkedIn: false }],
    });
    expect(dto).toEqual({
      id: "t1", name: "Byte Club", status: "PENDING_APPROVAL", size: 1, minSize: 2, maxSize: 4, incomplete: true, lookingForMembers: false,
      leaderDisplayName: "Margaret Hamilton",
      members: [{ rsvpId: "r1", displayName: "Margaret Hamilton", isLeader: true, checkedIn: false }],
    });
    expect(JSON.stringify(dto)).not.toContain("ada@example.test");
    expect(organiserTeamSchema.safeParse({ ...dto, joinToken: "x" }).success).toBe(false);
    expect(organiserTeamSchema.safeParse({ ...dto, members: [{ ...dto.members[0], email: "x@y.z" }] }).success).toBe(false);
  });

  it("adds teamName to guests, lookup rows and check-in results only when there is a team", () => {
    const row = { id: "r1", status: "CONFIRMED" as const, checkedInAt: null, createdAt: new Date("2030-01-01T00:00:00Z"), userId: null, guestName: "Bo", guestEmail: null, user: null };
    expect(toGuest(row)).not.toHaveProperty("teamName");
    expect(toGuest({ ...row, team: null })).not.toHaveProperty("teamName");
    expect(toGuest({ ...row, team: { name: "Byte Club" } }).teamName).toBe("Byte Club");
    const lookup = lookupRowToGuest({ rsvpId: "r1", displayName: "Bo", email: null, status: "CONFIRMED", checkedInAt: null, registeredAt: "2030-01-01T00:00:00.000Z", isGuest: true, teamName: "Byte Club" });
    expect(lookup.teamName).toBe("Byte Club");
    expect(lookupRowToGuest({ rsvpId: "r1", displayName: "Bo", email: null, status: "CONFIRMED", checkedInAt: null, registeredAt: "2030-01-01T00:00:00.000Z", teamName: null })).not.toHaveProperty("teamName");
    const result = toCheckInResult({ rsvpId: "r1", displayName: "Bo", email: null, status: "CONFIRMED", alreadyCheckedIn: false, checkedInAt: null, checkInQrToken: "tkSECRETticket", checkInDetails: [], registrationDetails: [], teamName: "Byte Club" });
    expect(result.teamName).toBe("Byte Club");
    expectNoSecrets(result);
    expect(guestSchema.safeParse({ ...lookup, teamId: "t1" }).success).toBe(false);
  });
});

describe("mobile judging DTOs", () => {
  const judgeRow = {
    id: "s1", title: "Bus Buddy", summary: "Buses", entrantName: "Byte Club", isTeam: true,
    repoUrl: "https://git.example/x", demoUrl: null, videoUrl: null, scoredCriteria: 0, reviewSubmitted: false,
  };

  it("shows project content, the team name and this judge's own review state only", () => {
    const dto = toJudgeSubmission({ ...judgeRow, disqualifiedReason: "Disqualified for plagiarism", entrantEmail: "ada@example.test", otherJudges: "otherJudgeScore" } as typeof judgeRow, false);
    expect(dto).toEqual({
      id: "s1", title: "Bus Buddy", summary: "Buses", links: { repo: "https://git.example/x", demo: null, video: null },
      entrantName: "Byte Club", teamName: "Byte Club", myReview: { status: "NONE", scoredCriteria: 0 },
    });
    expectNoSecrets(dto);
    const solo = toJudgeSubmission({ ...judgeRow, isTeam: false, entrantName: "Ada L." }, false);
    expect(solo).not.toHaveProperty("teamName");
    expect(judgeSubmissionSchema.safeParse({ ...dto, status: "DISQUALIFIED" }).success).toBe(false);
    expect(judgeSubmissionSchema.safeParse({ ...dto, disqualifiedReason: "x" }).success).toBe(false);
    expect(judgeSubmissionSchema.safeParse({ ...dto, entrantEmail: "x@y.z" }).success).toBe(false);
  });

  it("derives NONE, DRAFT and SUBMITTED", () => {
    expect(myReviewStatus({ reviewSubmitted: false, scoredCriteria: 0, hasReviewRow: false })).toBe("NONE");
    expect(myReviewStatus({ reviewSubmitted: false, scoredCriteria: 1, hasReviewRow: false })).toBe("DRAFT");
    expect(myReviewStatus({ reviewSubmitted: false, scoredCriteria: 0, hasReviewRow: true })).toBe("DRAFT");
    expect(myReviewStatus({ reviewSubmitted: true, scoredCriteria: 3, hasReviewRow: true })).toBe("SUBMITTED");
  });

  it("refuses other judges' scores or reviews in the detail DTO", () => {
    const detail = {
      judgingStatus: "OPEN", criteria: [], submission: toJudgeSubmission(judgeRow, false), myScores: [], myComment: null, mySubmittedAt: null,
    };
    expect(judgeSubmissionDetailDtoSchema.safeParse(detail).success).toBe(true);
    expect(judgeSubmissionDetailDtoSchema.safeParse({ ...detail, reviews: [] }).success).toBe(false);
    expect(judgeSubmissionDetailDtoSchema.safeParse({ ...detail, myScores: [{ criterionId: "c", score: 1, judgeUserId: "u2" }] }).success).toBe(false);
  });
});

describe("mobile refusal codes", () => {
  it("passes core codes through and keeps the message classification otherwise", () => {
    expect(classifyActionError({ ok: false, error: "This registration belongs to a team.", code: "TEAM_MEMBER" })).toBe("TEAM_MEMBER");
    expect(classifyActionError({ ok: false, error: "This team is incomplete.", code: "TEAM_INCOMPLETE" })).toBe("TEAM_INCOMPLETE");
    expect(classifyActionError({ ok: false, error: "Event is at capacity.", code: "CAPACITY_FULL" })).toBe("CAPACITY_FULL");
    expect(classifyActionError({ ok: false, error: "Judging is not open.", code: "JUDGING_CLOSED" })).toBe("JUDGING_CLOSED");
    expect(classifyActionError({ ok: false, error: "Score every criterion before submitting your review.", code: "INCOMPLETE_SCORES" })).toBe("INCOMPLETE_SCORES");
    expect(classifyActionError({ ok: false, error: "Submission not found.", code: "NOT_VISIBLE" })).toBe("NOT_VISIBLE");
    expect(classifyActionError({ ok: false, error: "Team not found." })).toBe("NOT_FOUND");
    expect(classifyActionError({ ok: false, error: "Unknown criterion." })).toBe("INVALID_REQUEST");
    expect(classifyActionError({ ok: false, error: "Scores for “Impact” go up to 5." })).toBe("INVALID_REQUEST");
    expect(classifyActionError({ ok: false, error: "Only pending teams can be approved." })).toBe("CONFLICT");
  });
});
