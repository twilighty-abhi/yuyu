import { describe, expect, it } from "vitest";
import {
  galleryHref,
  GALLERY_SORTS,
  isFilteredGalleryView,
  parseGalleryFilterParam,
  parseGalleryParams,
  parseGallerySortParam,
} from "@/lib/judgingPaging";
import { awardWinnerSql, galleryFromSql, galleryOrderSql, galleryWhereSql, projectSearchSql } from "@/lib/galleryQuery";
import { placeLabel } from "@/components/event/AwardBadges";

/* Public gallery URL params and SQL builders (docs/HACKATHON.md). */

describe("gallery params", () => {
  it("falls back to the defaults for anything invalid", () => {
    expect(parseGalleryParams({}, true)).toEqual({ page: 1, query: "", filter: "all", sort: "newest" });
    expect(parseGalleryParams({ page: "x", q: "   ", filter: "losers", sort: "score" }, true)).toEqual({ page: 1, query: "", filter: "all", sort: "newest" });
    expect(parseGalleryParams({ page: "3", q: "  solar   car ", filter: "winners", sort: "awards" }, true)).toEqual({ page: 3, query: "solar car", filter: "winners", sort: "awards" });
    // Repeated params use the first value.
    expect(parseGalleryParams({ sort: ["az", "awards"], filter: ["nope", "winners"] }, true)).toMatchObject({ sort: "az", filter: "all" });
    // Case matters: only the exact values are accepted.
    expect(parseGallerySortParam("AZ", true)).toBe("newest");
    expect(parseGalleryParams({ q: "x".repeat(300) }, true).query).toHaveLength(100);
  });

  it("allows winners and the awards order only once results are published", () => {
    expect(parseGalleryFilterParam("winners", false)).toBe("all");
    expect(parseGallerySortParam("awards", false)).toBe("newest");
    expect(parseGallerySortParam("az", false)).toBe("az");
    expect(parseGalleryFilterParam("winners", true)).toBe("winners");
    expect(parseGallerySortParam("awards", true)).toBe("awards");
    expect(GALLERY_SORTS).toEqual(["newest", "az", "awards"]);
  });

  it("builds short links and tells filtered views apart", () => {
    expect(galleryHref("/o/e/projects")).toBe("/o/e/projects");
    expect(galleryHref("/o/e/projects", { page: 1, query: "", filter: "all", sort: "newest" })).toBe("/o/e/projects");
    expect(galleryHref("/o/e/projects", { page: 2, query: "a&b", filter: "winners", sort: "awards" })).toBe("/o/e/projects?q=a%26b&filter=winners&sort=awards&page=2");
    expect(galleryHref("/o/e/projects", { sort: "az" })).toBe("/o/e/projects?sort=az");
    expect(isFilteredGalleryView({ query: "", filter: "all", sort: "newest" })).toBe(false);
    expect(isFilteredGalleryView({ query: "x", filter: "all", sort: "newest" })).toBe(true);
    expect(isFilteredGalleryView({ query: "", filter: "winners", sort: "newest" })).toBe(true);
    expect(isFilteredGalleryView({ query: "", filter: "all", sort: "az" })).toBe(true);
  });

  it("labels places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(placeLabel)).toEqual([
      "1st place", "2nd place", "3rd place", "4th place", "11th place", "12th place", "13th place", "21st place", "22nd place", "23rd place", "101st place",
    ]);
  });
});

describe("gallery SQL", () => {
  it("binds the search as an escaped ILIKE pattern", () => {
    expect(projectSearchSql("")).toBeNull();
    const search = projectSearchSql("100%_\\x")!;
    expect(search.values.every((value) => value === "%100\\%\\_\\\\x%")).toBe(true);
    expect(search.text).not.toContain("100%");
    expect(search.text).toContain(`s."title" ILIKE $1`);
  });

  it("scopes every listing to the event and SUBMITTED projects", () => {
    const plain = galleryWhereSql("evt_1", { query: "", filter: "all" });
    expect(plain.text).toBe(`s."eventId" = $1 AND s."status" = $2::"SubmissionStatus"`);
    expect(plain.values).toEqual(["evt_1", "SUBMITTED"]);
    const winners = galleryWhereSql("evt_1", { query: "rocket", filter: "winners" });
    expect(winners.values.slice(0, 2)).toEqual(["evt_1", "SUBMITTED"]);
    expect(winners.values).toContain("%rocket%");
    expect(winners.sql).toContain(awardWinnerSql().sql);
    // An award only counts within its own event.
    expect(awardWinnerSql().sql).toContain(`a."eventId" = s."eventId"`);
  });

  it("orders each sort with a unique id tiebreak", () => {
    for (const sort of GALLERY_SORTS) expect(galleryOrderSql(sort).sql).toMatch(/s\."id" (ASC|DESC)$/);
    expect(galleryOrderSql("newest").sql).toBe(`s."submittedAt" DESC, s."id" DESC`);
    expect(galleryOrderSql("az").sql).toBe(`lower(s."title") ASC, s."title" ASC, s."id" ASC`);
    expect(galleryOrderSql("awards").sql).toMatch(/^\(best\."awardId" IS NULL\) ASC, best\."awardPosition" ASC, best\."awardCreatedAt" ASC, best\."awardId" ASC, best\."place" ASC, lower/);
    expect(galleryFromSql("newest").sql).toBe(`"Submission" s`);
    expect(galleryFromSql("az").sql).not.toContain("LATERAL");
    expect(galleryFromSql("awards").sql).toContain("LEFT JOIN LATERAL");
    expect(galleryFromSql("awards").values).toEqual([]);
  });
});
