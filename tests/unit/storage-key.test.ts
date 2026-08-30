import { describe, expect, it } from "vitest";
import { isPublicDerivativeKey } from "@/lib/storage";

describe("public derivative storage keys", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";

  it("accepts only generated organisation image derivatives", () => {
    expect(isPublicDerivativeKey(`organisations/org_1/event-covers/${uuid}.webp`)).toBe(true);
    expect(isPublicDerivativeKey(`organisations/org_1/event-speakers/${uuid}.webp`)).toBe(true);
    expect(isPublicDerivativeKey(`organisations/org_1/event-sponsors/${uuid}.webp`)).toBe(true);
  });

  it("rejects traversal, encoded separators, arbitrary objects, and non-WebP files", () => {
    expect(isPublicDerivativeKey(`organisations/org_1/../secrets/${uuid}.webp`)).toBe(false);
    expect(isPublicDerivativeKey(`organisations/org_1/event-covers/%2e%2e.webp`)).toBe(false);
    expect(isPublicDerivativeKey(`backups/${uuid}.webp`)).toBe(false);
    expect(isPublicDerivativeKey(`organisations/org_1/event-covers/${uuid}.svg`)).toBe(false);
  });
});
