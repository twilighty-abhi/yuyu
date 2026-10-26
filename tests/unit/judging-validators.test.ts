import { describe, expect, it } from "vitest";
import {
  awardWinnerSchema,
  disqualifySubmissionSchema,
  eventAwardSchema,
  isHttpsSubmissionUrl,
  judgeReviewSchema,
  judgeScoresSchema,
  judgingCriterionSchema,
  judgingReorderSchema,
  judgingSettingsSchema,
  normalizeHttpsSubmissionUrl,
  submissionContentSchema,
  submissionTokenSchema,
} from "@/lib/validators";

describe("submission links", () => {
  it("accepts only https: URLs parsed by URL", () => {
    expect(isHttpsSubmissionUrl("https://github.com/team/project")).toBe(true);
    expect(isHttpsSubmissionUrl("https://example.test/demo?x=1#top")).toBe(true);
    expect(isHttpsSubmissionUrl("http://github.com/team/project")).toBe(false);
    expect(isHttpsSubmissionUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsSubmissionUrl("data:text/html,hi")).toBe(false);
    expect(isHttpsSubmissionUrl("ftp://example.test/file")).toBe(false);
    expect(isHttpsSubmissionUrl("//example.test/path")).toBe(false);
    expect(isHttpsSubmissionUrl("github.com/team/project")).toBe(false);
    expect(isHttpsSubmissionUrl("https://user:pass@example.test/")).toBe(false);
    expect(isHttpsSubmissionUrl("https://example.test/a b")).toBe(false);
    expect(isHttpsSubmissionUrl(`https://example.test/${"a".repeat(500)}`)).toBe(false);
  });

  it("stores links in canonical form so they always satisfy the database CHECK", () => {
    expect(normalizeHttpsSubmissionUrl("HTTPS://GitHub.com/acme/app")).toBe("https://github.com/acme/app");
    expect(normalizeHttpsSubmissionUrl("https:github.com/acme/app")).toBe("https://github.com/acme/app");
    expect(normalizeHttpsSubmissionUrl("http://github.com/acme/app")).toBeNull();
    const parsed = submissionContentSchema.parse({ title: "T", repoUrl: "HTTPS://example.test/a", demoUrl: "https:example.test/b", videoUrl: " https://example.test/c " });
    expect(parsed).toMatchObject({ repoUrl: "https://example.test/a", demoUrl: "https://example.test/b", videoUrl: "https://example.test/c" });
    for (const value of [parsed.repoUrl, parsed.demoUrl, parsed.videoUrl]) expect(value?.startsWith("https://")).toBe(true);
    // Normalising can't push a link past the length limit.
    expect(normalizeHttpsSubmissionUrl(`https://example.test/${"é".repeat(150)}`)).toBeNull();
  });

  it("parses project content, clearing empty links to null", () => {
    const parsed = submissionContentSchema.parse({
      title: "  Byte Me  ",
      summary: "Line one\nLine two",
      repoUrl: "https://github.com/team/project",
      demoUrl: "",
    });
    expect(parsed).toEqual({
      title: "Byte Me",
      summary: "Line one\nLine two",
      repoUrl: "https://github.com/team/project",
      demoUrl: null,
      videoUrl: null,
    });
  });

  it("refuses non-https links, long text, control characters, and unknown fields", () => {
    expect(submissionContentSchema.safeParse({ title: "T", repoUrl: "http://example.test" }).success).toBe(false);
    expect(submissionContentSchema.safeParse({ title: "T", videoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(submissionContentSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
    expect(submissionContentSchema.safeParse({ title: "x".repeat(120) }).success).toBe(true);
    expect(submissionContentSchema.safeParse({ title: "T", summary: "x".repeat(4001) }).success).toBe(false);
    expect(submissionContentSchema.safeParse({ title: "T", summary: "bad\u0000" }).success).toBe(false);
    expect(submissionContentSchema.safeParse({ title: "Bad\ntitle" }).success).toBe(false);
    expect(submissionContentSchema.safeParse({ title: "" }).success).toBe(false);
    expect(submissionContentSchema.safeParse({ title: "T", status: "SUBMITTED" }).success).toBe(false);
  });

  it("checks the submission link token shape", () => {
    expect(submissionTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(submissionTokenSchema.safeParse("short").success).toBe(false);
    expect(submissionTokenSchema.safeParse("a".repeat(42) + "/").success).toBe(false);
  });
});

describe("judging settings", () => {
  const open = "2030-01-01T09:00:00.000Z";
  const close = "2030-01-02T09:00:00.000Z";

  it("needs a full window, closing after it opens, when submissions are on", () => {
    expect(judgingSettingsSchema.safeParse({ submissionsEnabled: true, submissionsOpenAt: open, submissionsCloseAt: close, judgesSeeAll: true, projectGalleryPublic: false }).success).toBe(true);
    expect(judgingSettingsSchema.safeParse({ submissionsEnabled: true, submissionsOpenAt: open, submissionsCloseAt: "", judgesSeeAll: true, projectGalleryPublic: false }).success).toBe(false);
    expect(judgingSettingsSchema.safeParse({ submissionsEnabled: true, submissionsOpenAt: close, submissionsCloseAt: open, judgesSeeAll: true, projectGalleryPublic: false }).success).toBe(false);
    expect(judgingSettingsSchema.safeParse({ submissionsEnabled: true, submissionsOpenAt: open, submissionsCloseAt: open, judgesSeeAll: true, projectGalleryPublic: false }).success).toBe(false);
  });

  it("allows saving with submissions off and accepts form checkbox values", () => {
    const parsed = judgingSettingsSchema.parse({ submissionsEnabled: "false", submissionsOpenAt: "", submissionsCloseAt: "", judgesSeeAll: "on", projectGalleryPublic: "" });
    expect(parsed).toEqual({ submissionsEnabled: false, submissionsOpenAt: null, submissionsCloseAt: null, judgesSeeAll: true, projectGalleryPublic: false });
    expect(judgingSettingsSchema.safeParse({ submissionsEnabled: false, submissionsOpenAt: null, submissionsCloseAt: null, judgesSeeAll: true, projectGalleryPublic: false, judgingStatus: "OPEN" }).success).toBe(false);
  });
});

describe("rubric, awards, and moderation", () => {
  it("keeps weight and maximum score within 1..10", () => {
    expect(judgingCriterionSchema.parse({ name: "Impact", weight: "3", maxScore: 10 })).toEqual({ name: "Impact", description: "", weight: 3, maxScore: 10 });
    for (const weight of [0, 11, 1.5, -1]) expect(judgingCriterionSchema.safeParse({ name: "Impact", weight, maxScore: 5 }).success).toBe(false);
    for (const maxScore of [0, 11, 2.5]) expect(judgingCriterionSchema.safeParse({ name: "Impact", weight: 1, maxScore }).success).toBe(false);
    expect(judgingCriterionSchema.safeParse({ name: "x".repeat(81), weight: 1, maxScore: 5 }).success).toBe(false);
    expect(judgingCriterionSchema.safeParse({ name: "Impact", description: "x".repeat(501), weight: 1, maxScore: 5 }).success).toBe(false);
  });

  it("validates awards, winners, reorders, and disqualification reasons", () => {
    expect(eventAwardSchema.safeParse({ name: "Overall winner" }).success).toBe(true);
    expect(eventAwardSchema.safeParse({ name: "" }).success).toBe(false);
    expect(awardWinnerSchema.parse({ awardId: "a", submissionId: "s" })).toEqual({ awardId: "a", submissionId: "s", place: 1 });
    expect(awardWinnerSchema.safeParse({ awardId: "a", submissionId: "s", place: 0 }).success).toBe(false);
    expect(judgingReorderSchema.safeParse(["a", "b"]).success).toBe(true);
    expect(judgingReorderSchema.safeParse(["a", "a"]).success).toBe(false);
    expect(disqualifySubmissionSchema.safeParse({ submissionId: "s", reason: "" }).success).toBe(false);
    expect(disqualifySubmissionSchema.safeParse({ submissionId: "s", reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("scores and reviews", () => {
  it("accepts whole, non-negative scores, each criterion once", () => {
    expect(judgeScoresSchema.safeParse({ submissionId: "s", scores: [{ criterionId: "c1", score: 0 }, { criterionId: "c2", score: 10 }] }).success).toBe(true);
    expect(judgeScoresSchema.safeParse({ submissionId: "s", scores: [{ criterionId: "c1", score: -1 }] }).success).toBe(false);
    expect(judgeScoresSchema.safeParse({ submissionId: "s", scores: [{ criterionId: "c1", score: 2.5 }] }).success).toBe(false);
    expect(judgeScoresSchema.safeParse({ submissionId: "s", scores: [{ criterionId: "c1", score: 11 }] }).success).toBe(false);
    expect(judgeScoresSchema.safeParse({ submissionId: "s", scores: [{ criterionId: "c1", score: 1 }, { criterionId: "c1", score: 2 }] }).success).toBe(false);
  });

  it("limits the private comment and defaults to submitting", () => {
    expect(judgeReviewSchema.parse({ submissionId: "s" })).toEqual({ submissionId: "s", comment: "", submit: true });
    expect(judgeReviewSchema.safeParse({ submissionId: "s", comment: "x".repeat(2001) }).success).toBe(false);
    expect(judgeReviewSchema.safeParse({ submissionId: "s", comment: "x".repeat(2000), submit: false }).success).toBe(true);
  });
});
