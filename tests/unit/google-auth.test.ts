import { describe, expect, it } from "vitest";
import { hasVerifiedGoogleEmail } from "@/lib/googleAuth";

describe("hasVerifiedGoogleEmail", () => {
  it("accepts only an explicit verified-email claim", () => {
    expect(hasVerifiedGoogleEmail({ email: "person@example.com", email_verified: true })).toBe(true);
    expect(hasVerifiedGoogleEmail({ email: "person@example.com", email_verified: false })).toBe(false);
    expect(hasVerifiedGoogleEmail({ email: "person@example.com" })).toBe(false);
    expect(hasVerifiedGoogleEmail(null)).toBe(false);
  });
});
