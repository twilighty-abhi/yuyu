import { describe, expect, it, vi } from "vitest";

// lib/core/crew.ts is server-only and talks to the database; these tests cover
// only its pure helpers and schemas, so the I/O modules are stubbed.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/outbox", () => ({ enqueueRsvpConfirmation: vi.fn() }));
vi.mock("@/lib/webhooks/emit", () => ({ emitWebhookEvent: vi.fn() }));

import {
  crewJoinPath,
  crewProfileSchema,
  generateCrewJoinToken,
  isCrewJoinTokenShape,
  organiserCrewSchema,
  summariseFoodPreferences,
} from "@/lib/core/crew";

const base = { name: "Asha", email: "asha@example.test" };

describe("summariseFoodPreferences", () => {
  it("groups case-insensitively, keeping the first spelling seen", () => {
    expect(summariseFoodPreferences(["Vegan", "vegan", " VEGAN "])).toEqual([{ label: "Vegan", count: 3 }]);
  });

  it("counts blanks as Not given", () => {
    expect(summariseFoodPreferences(["", "   ", "Jain"])).toEqual([
      { label: "Not given", count: 2 },
      { label: "Jain", count: 1 },
    ]);
  });

  it("orders by count, then alphabetically", () => {
    expect(summariseFoodPreferences(["Vegan", "Jain", "Vegetarian", "Vegetarian", "Eggetarian"])).toEqual([
      { label: "Vegetarian", count: 2 },
      { label: "Eggetarian", count: 1 },
      { label: "Jain", count: 1 },
      { label: "Vegan", count: 1 },
    ]);
  });

  it("returns an empty list for no crew", () => {
    expect(summariseFoodPreferences([])).toEqual([]);
  });
});

describe("crew join tokens", () => {
  it("generates 256-bit base64url tokens that pass the shape check", () => {
    const token = generateCrewJoinToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(isCrewJoinTokenShape(token)).toBe(true);
    expect(generateCrewJoinToken()).not.toBe(token);
  });

  it("rejects malformed values before any lookup", () => {
    expect(isCrewJoinTokenShape(undefined)).toBe(false);
    expect(isCrewJoinTokenShape(null)).toBe(false);
    expect(isCrewJoinTokenShape(123)).toBe(false);
    expect(isCrewJoinTokenShape("")).toBe(false);
    expect(isCrewJoinTokenShape("a".repeat(31))).toBe(false);
    expect(isCrewJoinTokenShape("a".repeat(129))).toBe(false);
    expect(isCrewJoinTokenShape(`${"a".repeat(40)}/`)).toBe(false);
    expect(isCrewJoinTokenShape(`${"a".repeat(40)}=`)).toBe(false);
    expect(isCrewJoinTokenShape(` ${"a".repeat(40)}`)).toBe(false);
    expect(isCrewJoinTokenShape("a".repeat(32))).toBe(true);
    expect(isCrewJoinTokenShape("a".repeat(128))).toBe(true);
  });

  it("builds the public join path", () => {
    expect(crewJoinPath("abc_DEF-123")).toBe("/crew/abc_DEF-123");
    expect(crewJoinPath("a/b?c")).toBe("/crew/a%2Fb%3Fc");
  });
});

describe("crewProfileSchema", () => {
  it("trims fields, lowercases the email and fills defaults", () => {
    const parsed = crewProfileSchema.parse({ name: "  Asha Rao ", email: "  Asha@Example.TEST ", role: " Lead " });
    expect(parsed).toEqual({ name: "Asha Rao", email: "asha@example.test", foodPreference: "", role: "Lead", bio: "" });
  });

  it("requires a name and a valid email", () => {
    expect(crewProfileSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ name: "Asha" }).success).toBe(false);
  });

  it("enforces length limits", () => {
    expect(crewProfileSchema.safeParse({ ...base, name: "n".repeat(120) }).success).toBe(true);
    expect(crewProfileSchema.safeParse({ ...base, name: "n".repeat(121) }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, foodPreference: "f".repeat(81) }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, role: "r".repeat(121) }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, bio: "b".repeat(600) }).success).toBe(true);
    expect(crewProfileSchema.safeParse({ ...base, bio: "b".repeat(601) }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, email: `${"e".repeat(250)}@x.io` }).success).toBe(false);
  });

  it("accepts only HTTP(S) LinkedIn URLs", () => {
    expect(crewProfileSchema.parse({ ...base, linkedinUrl: " https://www.linkedin.com/in/asha " }).linkedinUrl).toBe("https://www.linkedin.com/in/asha");
    expect(crewProfileSchema.safeParse({ ...base, linkedinUrl: "http://linkedin.com/in/asha" }).success).toBe(true);
    expect(crewProfileSchema.safeParse({ ...base, linkedinUrl: "" }).success).toBe(true);
    expect(crewProfileSchema.safeParse({ ...base, linkedinUrl: null }).success).toBe(true);
    expect(crewProfileSchema.safeParse({ ...base, linkedinUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, linkedinUrl: "data:text/html,hi" }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, linkedinUrl: "ftp://linkedin.com/in/asha" }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, linkedinUrl: "linkedin.com/in/asha" }).success).toBe(false);
  });

  it("accepts only application upload URLs for photos", () => {
    expect(crewProfileSchema.safeParse({ ...base, photoUrl: "/api/uploads/organisations/o1/event-crew/p.webp" }).success).toBe(true);
    expect(crewProfileSchema.safeParse({ ...base, photoUrl: "https://evil.example/p.webp" }).success).toBe(false);
  });

  it("rejects unknown keys, including showOnPage from the public form", () => {
    expect(crewProfileSchema.safeParse({ ...base, showOnPage: true }).success).toBe(false);
    expect(crewProfileSchema.safeParse({ ...base, isCrew: false }).success).toBe(false);
  });
});

describe("organiserCrewSchema", () => {
  it("defaults showOnPage to true and keeps the profile rules", () => {
    expect(organiserCrewSchema.parse({ name: " Asha ", email: "ASHA@example.test" })).toEqual({
      name: "Asha",
      email: "asha@example.test",
      foodPreference: "",
      role: "",
      bio: "",
      showOnPage: true,
    });
    expect(organiserCrewSchema.parse({ ...base, showOnPage: false }).showOnPage).toBe(false);
    expect(organiserCrewSchema.safeParse({ ...base, showOnPage: "yes" }).success).toBe(false);
    expect(organiserCrewSchema.safeParse({ ...base, linkedinUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(organiserCrewSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});
