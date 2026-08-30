import { describe, expect, it } from "vitest";
import { publicOrgEventSelect, publicOrgInstanceSelect } from "@/lib/publicOrgEventDto";

describe("public organisation event DTO", () => {
  it("selects only card fields and excludes station/tenant internals", () => {
    expect(Object.keys(publicOrgEventSelect).sort()).toEqual([
      "coverImageUrl", "createdAt", "description", "endDateTime", "id", "isOnline",
      "location", "slug", "startDateTime", "status", "tags", "timezone", "title",
    ]);
    const serialized = JSON.stringify(publicOrgEventSelect);
    expect(serialized).not.toContain("checkInStation");
    expect(serialized).not.toContain("organisationId");
    expect(serialized).not.toContain("rsvps");
  });

  it("selects a minimal recurring occurrence and series card", () => {
    expect(Object.keys(publicOrgInstanceSelect).sort()).toEqual(["endDateTime", "id", "series", "startDateTime"]);
    expect(Object.keys(publicOrgInstanceSelect.series.select).sort()).toEqual(["createdAt", "description", "timezone", "title"]);
  });
});
